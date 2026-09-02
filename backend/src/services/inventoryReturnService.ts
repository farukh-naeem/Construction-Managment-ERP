import mongoose from "mongoose";
import { InventoryReturn, type IInventoryReturn, type InventoryReturnType } from "../models/InventoryReturn.js";
import { CustomerSaleEntry } from "../models/CustomerSaleEntry.js";
import { ItemLedgerEntry } from "../models/ItemLedgerEntry.js";
import { ConsumableItem } from "../models/ConsumableItem.js";
import { Customer } from "../models/Customer.js";
import { Vendor } from "../models/Vendor.js";
import { BankAccount } from "../models/BankAccount.js";
import { BankTransaction } from "../models/BankTransaction.js";
import { User } from "../models/User.js";
import { resolveSiteManagerProjectId } from "./projectAccessService.js";
import { getProjectName, logAudit } from "./auditService.js";
import { roleDisplay } from "./authService.js";

type PaymentMethod = "Cash" | "Bank" | "Online";

export interface CreateInventoryReturnInput {
  projectId: string;
  type: InventoryReturnType;
  customerId?: string;
  vendorId?: string;
  date: string;
  items: { itemId: string; quantity: number; unit: string; unitPrice: number }[];
  accountId: string;
  paymentMethod: PaymentMethod;
  referenceId?: string;
  remarks?: string;
}

export interface InventoryReturnPayload {
  id: string;
  projectId: string;
  type: InventoryReturnType;
  partyId: string;
  partyName: string;
  date: string;
  items: { itemId: string; itemName: string; quantity: number; unit: string; unitPrice: number; totalPrice: number }[];
  totalAmount: number;
  accountId: string;
  accountName: string;
  paymentMethod: PaymentMethod;
  referenceId?: string;
  remarks?: string;
}

function normalizeQuantity(value: number) {
  if (!Number.isFinite(value) || value <= 0) throw new Error("Quantity must be greater than 0");
  return Math.round(value * 100) / 100;
}

async function toPayload(doc: IInventoryReturn): Promise<InventoryReturnPayload> {
  const [party, account, items] = await Promise.all([
    doc.type === "sale_return"
      ? Customer.findById(doc.customerId).select("name").lean()
      : Vendor.findById(doc.vendorId).select("name").lean(),
    BankAccount.findById(doc.accountId).select("name").lean(),
    ConsumableItem.find({ _id: { $in: doc.items.map((line) => line.itemId) } }).select("name").lean(),
  ]);
  const names = new Map(items.map((item) => [item._id.toString(), item.name]));
  return {
    id: doc._id.toString(), projectId: doc.projectId.toString(), type: doc.type,
    partyId: (doc.customerId ?? doc.vendorId)!.toString(), partyName: party?.name ?? "Unknown",
    date: doc.date,
    items: doc.items.map((line) => ({
      itemId: line.itemId.toString(), itemName: names.get(line.itemId.toString()) ?? "Unknown item",
      quantity: line.quantity, unit: line.unit, unitPrice: line.unitPrice, totalPrice: line.totalPrice,
    })),
    totalAmount: doc.totalAmount, accountId: doc.accountId.toString(), accountName: account?.name ?? "Unknown account",
    paymentMethod: doc.paymentMethod, referenceId: doc.referenceId, remarks: doc.remarks,
  };
}

export async function listInventoryReturns(actor: { userId: string; role: string }, projectIdParam?: string) {
  let projectId = projectIdParam;
  if (actor.role === "site_manager") {
    projectId = await resolveSiteManagerProjectId(actor.userId, projectIdParam);
    if (!projectId) return [];
  }
  const query = projectId && mongoose.Types.ObjectId.isValid(projectId) ? { projectId } : {};
  const docs = await InventoryReturn.find(query).sort({ date: -1, createdAt: -1 }).lean();
  return Promise.all(docs.map(toPayload));
}

export async function createInventoryReturn(
  actor: { userId: string; email: string; role: string }, input: CreateInventoryReturnInput
): Promise<InventoryReturnPayload> {
  if (!input.date?.trim()) throw new Error("Date is required");
  if (!input.items?.length) throw new Error("At least one item is required");
  if (!mongoose.Types.ObjectId.isValid(input.accountId)) throw new Error("Select a bank account");
  if (!["sale_return", "purchase_return"].includes(input.type)) throw new Error("Invalid return type");
  if (!["Cash", "Bank", "Online"].includes(input.paymentMethod)) throw new Error("Invalid payment method");

  let projectId = input.projectId;
  if (actor.role === "site_manager") projectId = (await resolveSiteManagerProjectId(actor.userId, input.projectId)) ?? "";
  if (!projectId || !mongoose.Types.ObjectId.isValid(projectId)) throw new Error("Project is required");

  const partyId = input.type === "sale_return" ? input.customerId : input.vendorId;
  if (!partyId || !mongoose.Types.ObjectId.isValid(partyId)) throw new Error(input.type === "sale_return" ? "Customer is required" : "Vendor is required");
  const [party, account] = await Promise.all([
    input.type === "sale_return" ? Customer.findOne({ _id: partyId, projectId }).lean() : Vendor.findOne({ _id: partyId, projectId }).lean(),
    BankAccount.findById(input.accountId).lean(),
  ]);
  if (!party) throw new Error(input.type === "sale_return" ? "Customer not found in this project" : "Vendor not found in this project");
  if (!account) throw new Error("Bank account not found");
  const partyName = party.name;
  const partyTotals = party as typeof party & { totalSold?: number; totalReceived?: number; totalBilled?: number; totalPaid?: number };

  const seen = new Set<string>();
  const lines = input.items.map((line) => {
    if (!mongoose.Types.ObjectId.isValid(line.itemId)) throw new Error("Invalid item");
    if (seen.has(line.itemId)) throw new Error("Duplicate item in return");
    seen.add(line.itemId);
    if (!line.unit?.trim()) throw new Error("Unit is required");
    const quantity = normalizeQuantity(Number(line.quantity));
    const unitPrice = Number(line.unitPrice);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error("Unit price must be at least 0");
    return { itemId: line.itemId, quantity, unit: line.unit.trim(), unitPrice, totalPrice: quantity * unitPrice };
  });
  const totalAmount = lines.reduce((sum, line) => sum + line.totalPrice, 0);
  if (totalAmount <= 0) throw new Error("Return amount must be greater than 0");

  const itemDocs = await ConsumableItem.find({ _id: { $in: lines.map((line) => line.itemId) }, projectId }).lean();
  if (itemDocs.length !== lines.length) throw new Error("One or more items do not belong to this project");
  const itemById = new Map(itemDocs.map((item) => [item._id.toString(), item]));
  const previousReturns = await InventoryReturn.find({
    type: input.type, projectId, ...(input.type === "sale_return" ? { customerId: partyId } : { vendorId: partyId }),
    "items.itemId": { $in: lines.map((line) => line.itemId) },
  }).lean();
  const returnedByItem = new Map<string, number>();
  const returnedValueByItem = new Map<string, number>();
  for (const ret of previousReturns) for (const line of ret.items) {
    returnedByItem.set(line.itemId.toString(), (returnedByItem.get(line.itemId.toString()) ?? 0) + line.quantity);
    returnedValueByItem.set(line.itemId.toString(), (returnedValueByItem.get(line.itemId.toString()) ?? 0) + line.totalPrice);
  }
  const sourceDocs = input.type === "sale_return"
    ? await CustomerSaleEntry.find({ customerId: partyId, itemId: { $in: lines.map((line) => line.itemId) } }).lean()
    : await ItemLedgerEntry.find({ vendorId: partyId, itemId: { $in: lines.map((line) => line.itemId) } }).lean();
  const sourceByItem = new Map<string, number>();
  const sourceValueByItem = new Map<string, number>();
  for (const source of sourceDocs) {
    sourceByItem.set(source.itemId.toString(), (sourceByItem.get(source.itemId.toString()) ?? 0) + source.quantity);
    sourceValueByItem.set(source.itemId.toString(), (sourceValueByItem.get(source.itemId.toString()) ?? 0) + source.totalPrice);
  }
  for (const line of lines) {
    const available = Math.round(((sourceByItem.get(line.itemId) ?? 0) - (returnedByItem.get(line.itemId) ?? 0)) * 100) / 100;
    if (line.quantity > available) throw new Error(`Return quantity for ${itemById.get(line.itemId)?.name ?? "item"} exceeds the ${available} available from this ${input.type === "sale_return" ? "customer" : "vendor"}`);
    const availableValue = (sourceValueByItem.get(line.itemId) ?? 0) - (returnedValueByItem.get(line.itemId) ?? 0);
    if (line.totalPrice > availableValue) throw new Error(`Return value for ${itemById.get(line.itemId)?.name ?? "item"} exceeds the recorded value available to return`);
    if (input.type === "purchase_return" && line.quantity > (itemById.get(line.itemId)?.currentStock ?? 0)) throw new Error(`Only ${itemById.get(line.itemId)?.currentStock ?? 0} of ${itemById.get(line.itemId)?.name ?? "item"} are in stock`);
    if (input.type === "purchase_return" && (line.totalPrice > (itemById.get(line.itemId)?.totalAmount ?? 0) || line.totalPrice > (itemById.get(line.itemId)?.totalPaid ?? 0))) throw new Error(`Return/refund for ${itemById.get(line.itemId)?.name ?? "item"} exceeds its recorded purchased or paid amount`);
  }
  if (input.type === "sale_return" && ((partyTotals.totalSold ?? 0) < totalAmount || (partyTotals.totalReceived ?? 0) < totalAmount)) throw new Error("Return/refund exceeds this customer's recorded sales or payments");
  if (input.type === "purchase_return" && ((partyTotals.totalBilled ?? 0) < totalAmount || (partyTotals.totalPaid ?? 0) < totalAmount)) throw new Error("Return/refund exceeds this vendor's recorded purchases or payments");

  const session = await mongoose.startSession();
  let createdId!: mongoose.Types.ObjectId;
  try {
    await session.withTransaction(async () => {
      const bankType = input.type === "sale_return" ? "outflow" : "inflow";
      const [transaction] = await BankTransaction.create([{
        accountId: account._id, date: input.date.trim(), type: bankType, amount: totalAmount,
        source: input.type === "sale_return" ? account.name : partyName,
        destination: input.type === "sale_return" ? partyName : account.name,
        projectId, customerId: input.type === "sale_return" ? partyId : undefined,
        mode: input.paymentMethod, referenceId: input.referenceId?.trim() || undefined,
        remarks: input.remarks?.trim() || (input.type === "sale_return" ? `Sale return refund to ${partyName}` : `Purchase return refund from ${partyName}`),
      }], { session });
      await BankAccount.findByIdAndUpdate(account._id, { $inc: bankType === "inflow"
        ? { currentBalance: totalAmount, totalInflow: totalAmount }
        : { currentBalance: -totalAmount, totalOutflow: totalAmount } }, { session });
      const [created] = await InventoryReturn.create([{
        projectId, type: input.type, customerId: input.type === "sale_return" ? partyId : undefined,
        vendorId: input.type === "purchase_return" ? partyId : undefined, date: input.date.trim(), items: lines,
        totalAmount, accountId: account._id, bankTransactionId: transaction._id, paymentMethod: input.paymentMethod,
        referenceId: input.referenceId?.trim() || undefined, remarks: input.remarks?.trim() || undefined,
      }], { session });
      createdId = created._id;
      for (const line of lines) await ConsumableItem.findByIdAndUpdate(line.itemId, { $inc: input.type === "sale_return"
        ? { currentStock: line.quantity }
        : { currentStock: -line.quantity, totalPurchased: -line.quantity, totalAmount: -line.totalPrice, totalPaid: -line.totalPrice } }, { session });
      if (input.type === "sale_return") await Customer.findByIdAndUpdate(partyId, { $inc: { totalSold: -totalAmount, totalReceived: -totalAmount } }, { session });
      else await Vendor.findByIdAndUpdate(partyId, { $inc: { totalBilled: -totalAmount, totalPaid: -totalAmount } }, { session });
    });
  } finally { session.endSession(); }

  const actorUser = await User.findById(actor.userId).lean();
  await logAudit({
    userId: actor.userId, userName: actorUser?.name ?? "Unknown", userEmail: actor.email,
    role: roleDisplay[actor.role as keyof typeof roleDisplay] ?? actor.role, action: "create", module: "inventory_returns",
    entityId: createdId.toString(), projectId, projectName: await getProjectName(projectId),
    description: `${input.type === "sale_return" ? "Sale" : "Purchase"} return of ${totalAmount.toLocaleString()} PKR ${input.type === "sale_return" ? "to" : "from"} ${partyName}`,
    newValue: { type: input.type, party: partyName, totalAmount, account: account.name, items: lines.length },
  });
  const created = await InventoryReturn.findById(createdId).lean();
  if (!created) throw new Error("Return creation failed");
  return toPayload(created);
}
