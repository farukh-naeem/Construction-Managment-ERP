import mongoose from "mongoose";
import type { ClientSession } from "mongoose";
import { Customer } from "../models/Customer.js";
import { CustomerSaleEntry } from "../models/CustomerSaleEntry.js";
import { CustomerPayment } from "../models/CustomerPayment.js";
import { ConsumableItem } from "../models/ConsumableItem.js";
import { BankAccount } from "../models/BankAccount.js";
import { BankTransaction } from "../models/BankTransaction.js";
import { User } from "../models/User.js";
import { resolveSiteManagerProjectId } from "./projectAccessService.js";
import { logAudit, getProjectName } from "./auditService.js";
import { roleDisplay } from "./authService.js";

export type PaymentMethod = "Cash" | "Bank" | "Online";

export interface SaleLineInput {
  itemId: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  remarks?: string;
}

/** A payment recorded alongside a sale, or on its own from the customer ledger. */
export interface CustomerPaymentInput {
  date?: string;
  amount: number;
  paymentMethod: PaymentMethod;
  /** Required: money coming in must land in a tracked bank account. */
  accountId: string;
  referenceId?: string;
  remarks?: string;
}

export interface CreateCustomerSaleInput {
  projectId: string;
  customerId: string;
  date: string;
  remarks?: string;
  items: SaleLineInput[];
  payment?: CustomerPaymentInput;
}

export interface CustomerSaleLinePayload {
  id: string;
  itemId: string;
  itemName: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalPrice: number;
  remarks?: string;
}

export interface CustomerSalePayload {
  saleId: string;
  projectId: string;
  customerId: string;
  customerName: string;
  date: string;
  remarks?: string;
  items: CustomerSaleLinePayload[];
  totalAmount: number;
  /** Sum of payments linked to this sale (0 when the sale was recorded unpaid). */
  paidAmount: number;
}

/** Quantities follow the same .XX (2-decimal) convention as pricing elsewhere in the app. */
function normalizeQuantity(quantity: number): number {
  if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity <= 0) {
    throw new Error("Quantity must be a positive number");
  }
  return Math.round(quantity * 100) / 100;
}

function assertUniqueItems(items: SaleLineInput[]) {
  const seen = new Set<string>();
  for (const line of items) {
    if (seen.has(line.itemId)) {
      throw new Error("Duplicate item in this sale. Update the existing line instead of adding another.");
    }
    seen.add(line.itemId);
  }
}

/**
 * Records money received from a customer inside an open transaction: creates the bank inflow,
 * credits the account, writes the CustomerPayment, and credits the customer's balance.
 * Shared by createCustomerSale and createCustomerPayment so both paths move money identically.
 */
export async function recordCustomerPaymentInSession(
  session: ClientSession,
  params: {
    customer: { _id: mongoose.Types.ObjectId; name: string; projectId: mongoose.Types.ObjectId };
    accountId: string;
    accountName: string;
    date: string;
    amount: number;
    paymentMethod: PaymentMethod;
    referenceId?: string;
    remarks?: string;
    saleId?: mongoose.Types.ObjectId;
  }
): Promise<mongoose.Types.ObjectId> {
  // The bank ledger builds an inflow's "Reference / Remarks" cell from
  // [source, referenceId, remarks] — writing the customer name as `source` makes the
  // payment self-describing there without any change to getBankAccountLedger.
  const [tx] = await BankTransaction.create(
    [
      {
        accountId: params.accountId,
        date: params.date,
        type: "inflow",
        amount: params.amount,
        source: params.customer.name,
        destination: params.accountName,
        projectId: params.customer.projectId,
        customerId: params.customer._id,
        mode: params.paymentMethod,
        referenceId: params.referenceId,
        remarks: params.remarks,
      },
    ],
    { session }
  );

  await BankAccount.findByIdAndUpdate(
    params.accountId,
    { $inc: { currentBalance: params.amount, totalInflow: params.amount } },
    { session }
  );

  const [payment] = await CustomerPayment.create(
    [
      {
        customerId: params.customer._id,
        date: params.date,
        amount: params.amount,
        paymentMethod: params.paymentMethod,
        accountId: params.accountId,
        bankTransactionId: tx._id,
        saleId: params.saleId,
        referenceId: params.referenceId,
        remarks: params.remarks,
      },
    ],
    { session }
  );

  // Money in is a credit: it raises the signed balance.
  await Customer.findByIdAndUpdate(
    params.customer._id,
    { $inc: { totalReceived: params.amount, balance: params.amount } },
    { session }
  );

  return payment._id;
}

/** Validates a payment block and resolves its account. Runs before the transaction opens. */
export async function resolvePaymentAccount(payment: CustomerPaymentInput) {
  const amount = Number(payment.amount);
  if (isNaN(amount) || amount <= 0) throw new Error("Payment amount must be greater than 0");
  if (!["Cash", "Bank", "Online"].includes(payment.paymentMethod)) {
    throw new Error("Invalid payment method");
  }
  if (!payment.accountId || !mongoose.Types.ObjectId.isValid(payment.accountId)) {
    throw new Error("Select a bank account to record this payment");
  }
  const account = await BankAccount.findById(payment.accountId).lean();
  if (!account) throw new Error("Bank account not found");
  return { amount, account };
}

async function buildSalePayloads(
  entries: {
    _id: mongoose.Types.ObjectId;
    projectId: mongoose.Types.ObjectId;
    itemId: mongoose.Types.ObjectId;
    customerId: mongoose.Types.ObjectId;
    saleId: mongoose.Types.ObjectId;
    date: string;
    quantity: number;
    unit?: string;
    unitPrice: number;
    totalPrice: number;
    remarks?: string;
  }[]
): Promise<CustomerSalePayload[]> {
  if (entries.length === 0) return [];

  const itemIds = [...new Set(entries.map((e) => e.itemId.toString()))];
  const customerIds = [...new Set(entries.map((e) => e.customerId.toString()))];
  const saleIds = [...new Set(entries.map((e) => e.saleId.toString()))];

  const [items, customers, payments] = await Promise.all([
    ConsumableItem.find({ _id: { $in: itemIds } }).select("name").lean(),
    Customer.find({ _id: { $in: customerIds } }).select("name").lean(),
    CustomerPayment.find({ saleId: { $in: saleIds } }).select("saleId amount").lean(),
  ]);
  const itemNames = new Map(items.map((i) => [i._id.toString(), i.name]));
  const customerNames = new Map(customers.map((c) => [c._id.toString(), c.name]));
  const paidBySale = new Map<string, number>();
  for (const p of payments) {
    const key = p.saleId?.toString() ?? "";
    paidBySale.set(key, (paidBySale.get(key) ?? 0) + p.amount);
  }

  const bySale = new Map<string, CustomerSalePayload>();
  for (const entry of entries) {
    const key = entry.saleId.toString();
    let sale = bySale.get(key);
    if (!sale) {
      sale = {
        saleId: key,
        projectId: entry.projectId.toString(),
        customerId: entry.customerId.toString(),
        customerName: customerNames.get(entry.customerId.toString()) ?? "Unknown",
        date: entry.date,
        remarks: entry.remarks,
        items: [],
        totalAmount: 0,
        paidAmount: paidBySale.get(key) ?? 0,
      };
      bySale.set(key, sale);
    }
    sale.items.push({
      id: entry._id.toString(),
      itemId: entry.itemId.toString(),
      itemName: itemNames.get(entry.itemId.toString()) ?? "Unknown item",
      quantity: entry.quantity,
      unit: entry.unit ?? "",
      unitPrice: entry.unitPrice,
      totalPrice: entry.totalPrice,
      remarks: entry.remarks,
    });
    sale.totalAmount += entry.totalPrice;
  }

  return [...bySale.values()].sort((a, b) => b.date.localeCompare(a.date) || b.saleId.localeCompare(a.saleId));
}

/** List sales grouped by saleId. Site Manager: uses assigned project. */
export async function listCustomerSales(
  actor: { userId: string; role: string },
  projectIdParam?: string
): Promise<CustomerSalePayload[]> {
  let projectId: string | undefined;
  if (actor.role === "site_manager") {
    projectId = await resolveSiteManagerProjectId(actor.userId, projectIdParam);
    if (!projectId) return [];
  } else {
    projectId = projectIdParam;
  }
  const query =
    projectId && mongoose.Types.ObjectId.isValid(projectId) ? { projectId } : {};
  const entries = await CustomerSaleEntry.find(query).sort({ date: -1, createdAt: -1 }).lean();
  return buildSalePayloads(entries);
}

export async function getCustomerSale(saleId: string): Promise<CustomerSalePayload | null> {
  if (!mongoose.Types.ObjectId.isValid(saleId)) return null;
  const entries = await CustomerSaleEntry.find({ saleId }).lean();
  const [sale] = await buildSalePayloads(entries);
  return sale ?? null;
}

/**
 * Sells stock to a customer: N item lines in one submission, with an optional payment.
 * Stock leaves inventory, the sale debits the customer's balance, and any payment
 * credits it back while landing as a real inflow in the chosen bank account.
 */
export async function createCustomerSale(
  actor: { userId: string; email: string; role: string },
  input: CreateCustomerSaleInput
): Promise<CustomerSalePayload> {
  if (!input.date?.trim()) throw new Error("Date is required");
  if (!input.items || input.items.length === 0) throw new Error("At least one item is required");
  assertUniqueItems(input.items);

  let projectId: string;
  if (actor.role === "site_manager") {
    projectId = (await resolveSiteManagerProjectId(actor.userId, input.projectId)) ?? "";
    if (!projectId) throw new Error("Site Manager must be assigned to this project");
  } else {
    projectId = input.projectId ?? "";
    if (!projectId || !mongoose.Types.ObjectId.isValid(projectId)) {
      throw new Error("Project is required");
    }
  }

  if (!input.customerId || !mongoose.Types.ObjectId.isValid(input.customerId)) {
    throw new Error("Customer is required");
  }
  const customer = await Customer.findOne({ _id: input.customerId, projectId }).lean();
  if (!customer) throw new Error("Customer not found or does not belong to this project");

  const lines = input.items.map((line) => {
    if (!mongoose.Types.ObjectId.isValid(line.itemId)) throw new Error(`Invalid item ID: ${line.itemId}`);
    if (!line.unit?.trim()) throw new Error("Unit is required");
    const unitPrice = Number(line.unitPrice);
    if (isNaN(unitPrice) || unitPrice < 0) throw new Error("Unit price must be >= 0");
    const quantity = normalizeQuantity(Number(line.quantity));
    return {
      itemId: line.itemId,
      quantity,
      unit: line.unit.trim(),
      unitPrice,
      totalPrice: quantity * unitPrice,
      remarks: line.remarks?.trim() || input.remarks?.trim() || undefined,
    };
  });
  const saleTotal = lines.reduce((sum, line) => sum + line.totalPrice, 0);

  const resolvedPayment = input.payment ? await resolvePaymentAccount(input.payment) : null;

  const session = await mongoose.startSession();
  const saleId = new mongoose.Types.ObjectId();
  try {
    await session.withTransaction(async () => {
      // Re-check stock under the session so two concurrent sales can't both pass.
      for (const line of lines) {
        const item = await ConsumableItem.findOne({ _id: line.itemId, projectId }).session(session).lean();
        if (!item) throw new Error(`Item not found or does not belong to this project: ${line.itemId}`);
        if (item.currentStock < line.quantity) {
          throw new Error(
            `Insufficient stock for "${item.name}": available ${item.currentStock}, requested ${line.quantity}`
          );
        }
      }

      await CustomerSaleEntry.create(
        lines.map((line) => ({
          projectId,
          itemId: line.itemId,
          customerId: customer._id,
          saleId,
          date: input.date.trim(),
          quantity: line.quantity,
          unit: line.unit,
          unitPrice: line.unitPrice,
          totalPrice: line.totalPrice,
          remarks: line.remarks,
        })),
        // `ordered` is required by Mongoose when creating multiple documents in a session.
        { session, ordered: true }
      );

      // Stock leaves inventory. Purchase-side stats (totalPurchased/totalAmount/totalPaid/
      // totalPending) describe what we bought and are deliberately untouched by a sale.
      for (const line of lines) {
        await ConsumableItem.findByIdAndUpdate(
          line.itemId,
          { $inc: { currentStock: -line.quantity } },
          { session }
        );
      }

      // Goods out is a debit: it lowers the signed balance toward a receivable.
      await Customer.findByIdAndUpdate(
        customer._id,
        { $inc: { totalSold: saleTotal, balance: -saleTotal } },
        { session }
      );

      if (input.payment && resolvedPayment) {
        await recordCustomerPaymentInSession(session, {
          customer,
          accountId: input.payment.accountId,
          accountName: resolvedPayment.account.name,
          date: input.payment.date?.trim() || input.date.trim(),
          amount: resolvedPayment.amount,
          paymentMethod: input.payment.paymentMethod,
          referenceId: input.payment.referenceId?.trim() || undefined,
          remarks: input.payment.remarks?.trim() || input.remarks?.trim() || undefined,
          saleId,
        });
      }
    });
  } finally {
    session.endSession();
  }

  const actorUser = await User.findById(actor.userId).lean();
  const role = roleDisplay[actor.role as keyof typeof roleDisplay] ?? actor.role;
  await logAudit({
    userId: actor.userId,
    userName: actorUser?.name ?? "Unknown",
    userEmail: actor.email,
    role,
    action: "create",
    module: "customer_sales",
    entityId: saleId.toString(),
    projectId,
    projectName: await getProjectName(projectId),
    description: `Sold ${lines.length} item(s) worth ${saleTotal.toLocaleString()} PKR to ${customer.name}`,
    newValue: { customer: customer.name, total: saleTotal, items: lines.length, paid: resolvedPayment?.amount ?? 0 },
  });

  const created = await getCustomerSale(saleId.toString());
  if (!created) throw new Error("Sale creation failed");
  return created;
}

/** Reverses a sale: restores stock on every line and removes the debit from the customer. */
export async function deleteCustomerSale(
  actor: { userId: string; email: string; role: string },
  saleId: string
): Promise<void> {
  if (!mongoose.Types.ObjectId.isValid(saleId)) {
    throw new Error("Invalid sale ID");
  }

  const entries = await CustomerSaleEntry.find({ saleId }).lean();
  if (entries.length === 0) throw new Error("Sale not found");

  // A linked payment already moved money into a bank account; reversing that is the
  // ledger's job, not this one's. Require it to be undone explicitly first.
  const linkedPayments = await CustomerPayment.find({ saleId }).select("amount").lean();
  if (linkedPayments.length > 0) {
    const total = linkedPayments.reduce((sum, p) => sum + p.amount, 0);
    throw new Error(
      `Cannot delete this sale: it has a linked payment of ${total.toLocaleString()} PKR. Delete the payment from the customer's ledger first.`
    );
  }

  const customer = await Customer.findById(entries[0].customerId).lean();
  const saleTotal = entries.reduce((sum, e) => sum + e.totalPrice, 0);

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      for (const entry of entries) {
        await ConsumableItem.findByIdAndUpdate(
          entry.itemId,
          { $inc: { currentStock: entry.quantity } },
          { session }
        );
      }

      await Customer.findByIdAndUpdate(
        entries[0].customerId,
        { $inc: { totalSold: -saleTotal, balance: saleTotal } },
        { session }
      );

      await CustomerSaleEntry.deleteMany({ saleId }, { session });
    });
  } finally {
    session.endSession();
  }

  const actorUser = await User.findById(actor.userId).lean();
  const role = roleDisplay[actor.role as keyof typeof roleDisplay] ?? actor.role;
  await logAudit({
    userId: actor.userId,
    userName: actorUser?.name ?? "Unknown",
    userEmail: actor.email,
    role,
    action: "delete",
    module: "customer_sales",
    entityId: saleId,
    projectId: entries[0].projectId?.toString(),
    projectName: await getProjectName(entries[0].projectId?.toString()),
    description: `Deleted sale of ${saleTotal.toLocaleString()} PKR to ${customer?.name ?? "customer"} — stock restored`,
    oldValue: { customer: customer?.name, total: saleTotal, items: entries.length },
  });
}
