import mongoose from "mongoose";
import { Customer } from "../models/Customer.js";
import { CustomerSaleEntry } from "../models/CustomerSaleEntry.js";
import { CustomerPayment } from "../models/CustomerPayment.js";
import { ConsumableItem } from "../models/ConsumableItem.js";
import { BankAccount } from "../models/BankAccount.js";
import { BankTransaction } from "../models/BankTransaction.js";
import { User } from "../models/User.js";
import { logAudit, getProjectName } from "./auditService.js";
import { roleDisplay } from "./authService.js";
import {
  recordCustomerPaymentInSession,
  resolvePaymentAccount,
  type CustomerPaymentInput,
  type PaymentMethod,
} from "./customerSaleService.js";

export interface CustomerPaymentPayload {
  id: string;
  customerId: string;
  date: string;
  amount: number;
  paymentMethod: PaymentMethod;
  accountId: string;
  accountName?: string;
  referenceId?: string;
  remarks?: string;
}

export interface CreateCustomerPaymentInput {
  date: string;
  amount: number;
  paymentMethod: PaymentMethod;
  /** Required: the bank account the money lands in. */
  accountId: string;
  referenceId?: string;
  remarks?: string;
}

export interface CustomerLedgerRow {
  type: "sale" | "payment";
  id: string;
  date: string;
  /** For sale rows: groups every line of one "Sell Items" submission; deleting removes the group. */
  saleId?: string;
  /** For sale rows */
  itemName?: string;
  quantity?: number;
  unit?: string;
  unitPrice?: number;
  totalPrice?: number;
  /** For payment rows */
  amount?: number;
  paymentMethod?: PaymentMethod;
  accountName?: string;
  referenceId?: string;
  remarks?: string;
  /** Signed running balance. Payments credit (+); sales debit (−). Negative = customer owes us. */
  runningTotal: number;
}

const DEFAULT_PAGE_SIZE = 12;

export interface GetCustomerLedgerOptions {
  page?: number;
  pageSize?: number;
  startDate?: string;
  endDate?: string;
}

/**
 * Returns the combined "customer ledger": stock-sale rows + payment rows, oldest first.
 * The mirror of getVendorLedger with the deltas flipped — a payment received raises the
 * balance, a sale lowers it, so a negative running balance is a receivable.
 *
 * Totals are all-time; only the rows and the running balance respond to the date range.
 */
export async function getCustomerLedger(
  customerId: string,
  options?: GetCustomerLedgerOptions
): Promise<{
  rows: CustomerLedgerRow[];
  totalSold: number;
  totalReceived: number;
  balance: number;
  receivable: number;
  credit: number;
  previousBalance: number;
  total: number;
}> {
  if (!mongoose.Types.ObjectId.isValid(customerId)) {
    throw new Error("Invalid customer ID");
  }

  const startDate = options?.startDate?.trim() || undefined;
  const endDate = options?.endDate?.trim() || undefined;

  const [saleEntries, payments] = await Promise.all([
    CustomerSaleEntry.find({ customerId }).sort({ date: -1 }).lean(),
    CustomerPayment.find({ customerId }).sort({ date: -1 }).lean(),
  ]);

  const itemIds = [...new Set(saleEntries.map((e) => e.itemId.toString()))];
  const accountIds = [...new Set(payments.map((p) => p.accountId?.toString()).filter(Boolean))];
  const [itemDocs, accountDocs] = await Promise.all([
    ConsumableItem.find({ _id: { $in: itemIds } }).select("name").lean(),
    BankAccount.find({ _id: { $in: accountIds } }).select("name").lean(),
  ]);
  const itemNames = new Map(itemDocs.map((i) => [i._id.toString(), i.name]));
  const accountNames = new Map(accountDocs.map((a) => [a._id.toString(), a.name]));

  let totalSold = 0;
  const saleRows: CustomerLedgerRow[] = saleEntries.map((entry) => {
    totalSold += entry.totalPrice;
    return {
      type: "sale" as const,
      id: entry._id.toString(),
      saleId: entry.saleId.toString(),
      date: entry.date,
      itemName: itemNames.get(entry.itemId.toString()) ?? "Unknown item",
      quantity: entry.quantity,
      unit: entry.unit,
      unitPrice: entry.unitPrice,
      totalPrice: entry.totalPrice,
      remarks: entry.remarks,
      runningTotal: 0,
    };
  });

  let totalReceived = 0;
  const paymentRows: CustomerLedgerRow[] = payments.map((payment) => {
    totalReceived += payment.amount;
    return {
      type: "payment" as const,
      id: payment._id.toString(),
      date: payment.date,
      amount: payment.amount,
      paymentMethod: payment.paymentMethod,
      accountName: accountNames.get(payment.accountId?.toString() ?? ""),
      referenceId: payment.referenceId,
      remarks: payment.remarks,
      runningTotal: 0,
    };
  });

  // Signed balance is the source of truth: credit (money received) minus debit (goods sold).
  // It intentionally goes negative once the customer has taken more stock than they paid for.
  const balance = totalReceived - totalSold;

  const ascendingRaw = [
    ...saleEntries.map((e) => ({
      key: `sale:${e._id}`,
      id: e._id.toString(),
      date: e.date,
      delta: -e.totalPrice,
    })),
    ...payments.map((p) => ({
      key: `payment:${p._id}`,
      id: p._id.toString(),
      date: p.date,
      delta: p.amount,
    })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

  const previousBalance = startDate
    ? ascendingRaw.filter((r) => r.date < startDate).reduce((sum, r) => sum + r.delta, 0)
    : 0;

  const runningByKey = new Map<string, number>();
  let running = previousBalance;
  for (const r of ascendingRaw) {
    if (startDate && r.date < startDate) continue;
    if (endDate && r.date > endDate) continue;
    running += r.delta;
    runningByKey.set(r.key, running);
  }

  const allRows = [...saleRows, ...paymentRows]
    .filter((r) => (!startDate || r.date >= startDate) && (!endDate || r.date <= endDate))
    .map((r) => ({ ...r, runningTotal: runningByKey.get(`${r.type}:${r.id}`) ?? previousBalance }))
    // Oldest first. ObjectId preserves a consistent creation-order tie-break on the same date.
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

  const total = allRows.length;
  const pageSize = Math.min(Math.max(1, options?.pageSize ?? DEFAULT_PAGE_SIZE), 100);
  const page = Math.max(1, options?.page ?? 1);
  const start = (page - 1) * pageSize;
  const rows = allRows.slice(start, start + pageSize);

  return {
    rows,
    totalSold,
    totalReceived,
    balance,
    receivable: Math.max(0, -balance),
    credit: Math.max(0, balance),
    previousBalance,
    total,
  };
}

/** Records money received from a customer, landing it as an inflow in the chosen bank account. */
export async function createCustomerPayment(
  actor: { userId: string; email: string; role: string },
  customerId: string,
  input: CreateCustomerPaymentInput
): Promise<CustomerPaymentPayload> {
  if (!mongoose.Types.ObjectId.isValid(customerId)) {
    throw new Error("Invalid customer ID");
  }
  if (!input.date?.trim()) throw new Error("Date is required");

  const customer = await Customer.findById(customerId).lean();
  if (!customer) throw new Error("Customer not found");

  const { amount, account } = await resolvePaymentAccount(input as CustomerPaymentInput);

  const session = await mongoose.startSession();
  let paymentId: mongoose.Types.ObjectId;
  try {
    await session.withTransaction(async () => {
      paymentId = await recordCustomerPaymentInSession(session, {
        customer,
        accountId: input.accountId,
        accountName: account.name,
        date: input.date.trim(),
        amount,
        paymentMethod: input.paymentMethod,
        referenceId: input.referenceId?.trim() || undefined,
        remarks: input.remarks?.trim() || undefined,
      });
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
    module: "customer_payments",
    entityId: paymentId!.toString(),
    projectId: customer.projectId?.toString(),
    projectName: await getProjectName(customer.projectId?.toString()),
    description: `Received ${amount.toLocaleString()} PKR from ${customer.name} into ${account.name}`,
    newValue: { amount, account: account.name, method: input.paymentMethod },
  });

  return {
    id: paymentId!.toString(),
    customerId,
    date: input.date.trim(),
    amount,
    paymentMethod: input.paymentMethod,
    accountId: input.accountId,
    accountName: account.name,
    referenceId: input.referenceId?.trim() || undefined,
    remarks: input.remarks?.trim() || undefined,
  };
}

/** Reverses a payment: removes the bank inflow, debits the account back, and lowers the balance. */
export async function deleteCustomerPayment(
  actor: { userId: string; email: string; role: string },
  customerId: string,
  paymentId: string
): Promise<void> {
  if (!mongoose.Types.ObjectId.isValid(paymentId)) {
    throw new Error("Invalid payment ID");
  }

  const existing = await CustomerPayment.findById(paymentId).lean();
  if (!existing) throw new Error("Payment not found");
  if (existing.customerId.toString() !== customerId) {
    throw new Error("Payment does not belong to this customer");
  }

  const [customer, account] = await Promise.all([
    Customer.findById(existing.customerId).lean(),
    BankAccount.findById(existing.accountId).lean(),
  ]);
  if (!account) throw new Error("Bank account not found");
  if (account.currentBalance < existing.amount) {
    throw new Error("Cannot delete: reversing this inflow would make bank balance negative.");
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await BankTransaction.findByIdAndDelete(existing.bankTransactionId, { session });

      await BankAccount.findByIdAndUpdate(
        existing.accountId,
        { $inc: { currentBalance: -existing.amount, totalInflow: -existing.amount } },
        { session }
      );

      await Customer.findByIdAndUpdate(
        existing.customerId,
        { $inc: { totalReceived: -existing.amount, balance: -existing.amount } },
        { session }
      );

      await CustomerPayment.findByIdAndDelete(paymentId, { session });
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
    module: "customer_payments",
    entityId: paymentId,
    projectId: customer?.projectId?.toString(),
    projectName: await getProjectName(customer?.projectId?.toString()),
    description: `Deleted ${existing.amount.toLocaleString()} PKR payment from ${customer?.name ?? "customer"} — ${account.name} inflow reversed`,
    oldValue: { amount: existing.amount, account: account.name },
  });
}
