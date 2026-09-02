import mongoose from "mongoose";
import { ItemLedgerEntry } from "../models/ItemLedgerEntry.js";
import { VendorPayment } from "../models/VendorPayment.js";
import { StockConsumptionEntry } from "../models/StockConsumptionEntry.js";
import { CustomerSaleEntry } from "../models/CustomerSaleEntry.js";
import { Customer } from "../models/Customer.js";
import { ConsumableItem } from "../models/ConsumableItem.js";
import { Vendor } from "../models/Vendor.js";
import { User } from "../models/User.js";
import { logAudit, getProjectName } from "./auditService.js";
import { roleDisplay } from "./authService.js";
import { getFifoAllocationForVendor } from "./fifoAllocation.js";
import { resolveSiteManagerProjectId } from "./projectAccessService.js";
import type { IConsumableItem } from "../models/ConsumableItem.js";
import type { IVendor } from "../models/Vendor.js";

export interface ItemLedgerPayload {
  type: "purchase";
  id: string;
  projectId: string;
  itemId: string;
  vendorId: string;
  vendorName: string;
  date: string;
  quantity: number;
  unit?: string;
  unitPrice: number;
  totalPrice: number;
  paidAmount: number;
  remaining: number;
  advanceGenerated: number;
  biltyNumber?: string;
  vehicleNumber?: string;
  paymentMethod: "Cash" | "Bank" | "Online";
  referenceId?: string;
  remarks?: string;
  runningBalance?: number;
}

export interface ItemConsumptionLedgerPayload {
  type: "consumption";
  id: string;
  date: string;
  quantityUsed: number;
  unit?: string;
  remarks?: string;
  runningBalance: number;
}

/** Stock sold to a customer. Reduces stock like consumption, but carries a price and a buyer. */
export interface ItemSaleLedgerPayload {
  type: "sale";
  id: string;
  saleId: string;
  date: string;
  customerId: string;
  customerName: string;
  quantitySold: number;
  unit?: string;
  unitPrice: number;
  totalPrice: number;
  remarks?: string;
  runningBalance: number;
}

export type ItemLedgerRowPayload = ItemLedgerPayload | ItemConsumptionLedgerPayload | ItemSaleLedgerPayload;

/** Quantities follow the same .XX (2-decimal) convention as pricing elsewhere in the app. */
function normalizeQuantity(quantity: number): number {
  return Math.round(quantity * 100) / 100;
}

export interface CreateItemLedgerInput {
  projectId: string;
  itemId: string;
  vendorId: string;
  date: string;
  quantity: number;
  unit?: string;
  unitPrice: number;
  paidAmount?: number;
  biltyNumber?: string;
  vehicleNumber?: string;
  paymentMethod: "Cash" | "Bank" | "Online";
  referenceId?: string;
  remarks?: string;
}

export interface UpdateItemLedgerInput {
  vendorId?: string;
  date?: string;
  quantity?: number;
  unit?: string;
  unitPrice?: number;
  paidAmount?: number;
  biltyNumber?: string;
  vehicleNumber?: string;
  paymentMethod?: "Cash" | "Bank" | "Online";
  referenceId?: string;
  remarks?: string;
}

export interface BulkItemLedgerInput {
  projectId: string;
  entries: CreateItemLedgerInput[];
}

export class BulkItemValidationError extends Error {
  constructor(public rows: { rowIndex: number; message: string }[]) {
    super("Bulk validation failed");
  }
}

async function buildPayload(doc: {
  _id: mongoose.Types.ObjectId;
  projectId: mongoose.Types.ObjectId;
  itemId: mongoose.Types.ObjectId;
  vendorId: mongoose.Types.ObjectId;
  date: string;
  quantity: number;
  unit?: string;
  unitPrice: number;
  totalPrice: number;
  paidAmount: number;
  remaining: number;
  advanceGenerated: number;
  biltyNumber?: string;
  vehicleNumber?: string;
  paymentMethod: "Cash" | "Bank" | "Online";
  referenceId?: string;
  remarks?: string;
}): Promise<ItemLedgerPayload> {
  const vendor = await Vendor.findById(doc.vendorId).select("name").lean();
  return {
    type: "purchase",
    id: doc._id.toString(),
    projectId: doc.projectId.toString(),
    itemId: doc.itemId.toString(),
    vendorId: doc.vendorId.toString(),
    vendorName: vendor?.name ?? "Unknown",
    date: doc.date,
    quantity: doc.quantity,
    unit: doc.unit,
    unitPrice: doc.unitPrice,
    totalPrice: doc.totalPrice,
    paidAmount: doc.paidAmount,
    remaining: doc.remaining,
    advanceGenerated: doc.advanceGenerated,
    biltyNumber: doc.biltyNumber,
    vehicleNumber: doc.vehicleNumber,
    paymentMethod: doc.paymentMethod,
    referenceId: doc.referenceId,
    remarks: doc.remarks,
  };
}

const DEFAULT_PAGE_SIZE = 12;

export interface ListItemLedgerOptions {
  page?: number;
  pageSize?: number;
}

export interface ListItemLedgerResult {
  entries: ItemLedgerRowPayload[];
  total: number;
}

export async function listItemLedger(
  itemId: string,
  options?: ListItemLedgerOptions
): Promise<ListItemLedgerResult> {
  if (!mongoose.Types.ObjectId.isValid(itemId)) {
    return { entries: [], total: 0 };
  }
  const [docs, consumptionDocs, saleDocs] = await Promise.all([
    ItemLedgerEntry.find({ itemId }).sort({ date: 1, createdAt: 1 }).lean(),
    StockConsumptionEntry.find({ "items.itemId": itemId }).sort({ date: 1, createdAt: 1 }).lean(),
    CustomerSaleEntry.find({ itemId }).sort({ date: 1, createdAt: 1 }).lean(),
  ]);
  const vendorIds = [...new Set(docs.map((d) => d.vendorId.toString()))];
  const allocationByVendor = new Map<string, Awaited<ReturnType<typeof getFifoAllocationForVendor>>>();
  await Promise.all(
    vendorIds.map(async (vid) => {
      allocationByVendor.set(vid, await getFifoAllocationForVendor(vid));
    })
  );
  const payloads = await Promise.all(docs.map(buildPayload));
  for (let i = 0; i < payloads.length; i++) {
    const alloc = allocationByVendor.get(docs[i].vendorId.toString())?.get(payloads[i].id);
    if (alloc) {
      payloads[i].paidAmount = alloc.allocatedPaid;
      payloads[i].remaining = alloc.allocatedRemaining;
    }
  }
  const consumptionRows: ItemConsumptionLedgerPayload[] = consumptionDocs.flatMap((doc) =>
    doc.items
      .filter((line) => line.itemId.toString() === itemId)
      .map((line) => ({
        type: "consumption" as const,
        id: doc._id.toString(),
        date: doc.date,
        quantityUsed: line.quantityUsed,
        unit: line.unit,
        remarks: doc.remarks,
        runningBalance: 0,
      }))
  );
  const customerIds = [...new Set(saleDocs.map((d) => d.customerId.toString()))];
  const customerDocs = customerIds.length
    ? await Customer.find({ _id: { $in: customerIds } }).select("name").lean()
    : [];
  const customerNames = new Map(customerDocs.map((c) => [c._id.toString(), c.name]));
  const saleRows: ItemSaleLedgerPayload[] = saleDocs.map((doc) => ({
    type: "sale" as const,
    id: doc._id.toString(),
    saleId: doc.saleId.toString(),
    date: doc.date,
    customerId: doc.customerId.toString(),
    customerName: customerNames.get(doc.customerId.toString()) ?? "Unknown customer",
    quantitySold: doc.quantity,
    unit: doc.unit,
    unitPrice: doc.unitPrice,
    totalPrice: doc.totalPrice,
    remarks: doc.remarks,
    runningBalance: 0,
  }));

  const allRows: ItemLedgerRowPayload[] = [...payloads, ...consumptionRows, ...saleRows].sort(
    (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)
  );
  let balance = 0;
  for (const row of allRows) {
    balance +=
      row.type === "purchase" ? row.quantity
        : row.type === "sale" ? -row.quantitySold
        : -row.quantityUsed;
    row.runningBalance = balance;
  }
  const total = allRows.length;
  const pageSize = Math.min(Math.max(1, options?.pageSize ?? DEFAULT_PAGE_SIZE), 100);
  const page = Math.max(1, options?.page ?? 1);
  const start = (page - 1) * pageSize;
  const entries = allRows.slice(start, start + pageSize);
  return { entries, total };
}

function validateItemLedgerInput(input: CreateItemLedgerInput) {
  if (!input.date?.trim()) throw new Error("Date is required");
  if (!Number.isFinite(Number(input.quantity)) || Number(input.quantity) <= 0) throw new Error("Quantity must be greater than 0");
  if (!input.unit?.trim()) throw new Error("Unit is required");
  if (input.unitPrice == null || !Number.isFinite(Number(input.unitPrice)) || Number(input.unitPrice) < 0) throw new Error("Unit price must be >= 0");
  if (input.paidAmount != null && (!Number.isFinite(Number(input.paidAmount)) || Number(input.paidAmount) < 0)) throw new Error("Paid amount must be >= 0");
  if (!input.vendorId || !mongoose.Types.ObjectId.isValid(input.vendorId)) throw new Error("Vendor is required");
  if (!mongoose.Types.ObjectId.isValid(input.itemId)) throw new Error("Invalid item ID");
  if (!["Cash", "Bank", "Online"].includes(input.paymentMethod)) throw new Error("Invalid payment method");
}

export async function applyItemLedgerEntry(
  session: mongoose.ClientSession,
  input: CreateItemLedgerInput,
  item: IConsumableItem,
  _vendor: IVendor
) {
  const quantity = normalizeQuantity(Number(input.quantity));
  const unitPrice = Number(input.unitPrice);
  const totalPrice = quantity * unitPrice;
  const rawPaid = Number(input.paidAmount ?? 0);
  const [entry] = await ItemLedgerEntry.create([{
    projectId: item.projectId, itemId: item._id, vendorId: input.vendorId,
    date: input.date.trim(), quantity, unit: input.unit?.trim() || undefined,
    unitPrice, totalPrice, paidAmount: 0, remaining: totalPrice, advanceGenerated: 0,
    biltyNumber: input.biltyNumber?.trim() || undefined,
    vehicleNumber: input.vehicleNumber?.trim() || undefined,
    paymentMethod: input.paymentMethod,
    referenceId: input.referenceId?.trim() || undefined,
    remarks: input.remarks?.trim() || undefined,
  }], { session });
  if (rawPaid > 0) {
    await VendorPayment.create([{
      vendorId: input.vendorId, date: input.date.trim(), amount: rawPaid,
      paymentMethod: input.paymentMethod, source: "external", advancePortion: 0,
      targetEntryId: entry._id, referenceId: input.referenceId?.trim() || undefined,
      remarks: input.remarks?.trim() || `Payment for ${item.name}`,
    }], { session });
  }
  await ConsumableItem.findByIdAndUpdate(item._id, { $inc: {
    currentStock: quantity, totalPurchased: quantity, totalAmount: totalPrice,
    totalPaid: rawPaid, totalPending: Math.max(0, totalPrice - rawPaid),
  } }, { session });
  await Vendor.findByIdAndUpdate(input.vendorId, { $inc: {
    totalBilled: totalPrice, totalPaid: rawPaid, remaining: totalPrice - rawPaid,
    advanceBalance: Math.max(0, rawPaid - totalPrice),
  } }, { session });
  return entry;
}

/** Add item ledger entry: creates entry, updates item totals and vendor denormalized totals in a transaction. */
export async function createItemLedgerEntry(
  actor: { userId: string; email: string; role: string },
  input: CreateItemLedgerInput
): Promise<ItemLedgerPayload> {
  validateItemLedgerInput(input);
  input.quantity = normalizeQuantity(Number(input.quantity));
  const totalPrice = input.quantity * Number(input.unitPrice);
  const rawPaid = input.paidAmount ?? 0;
  // An invoice is always its own bill row. When money is entered alongside it, create a
  // separate VendorPayment row below it rather than embedding payment/advance into the bill.
  const item = await ConsumableItem.findById(input.itemId).lean();
  if (!item) throw new Error("Item not found");

  const vendor = await Vendor.findOne({ _id: input.vendorId, projectId: item.projectId }).lean();
  if (!vendor) throw new Error("Vendor not found or does not belong to this project");

  const session = await mongoose.startSession();
  let result: ItemLedgerPayload;
  try {
    await session.withTransaction(async () => {
      const entry = await applyItemLedgerEntry(session, input, item, vendor);
      result = await buildPayload(entry);
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
    module: "item_ledger",
    entityId: result!.id,
    projectId: item.projectId?.toString(),
    projectName: await getProjectName(item.projectId?.toString()),
    description: `Added ledger entry: ${item.name} — qty ${input.quantity} @ ${input.unitPrice}`,
    newValue: { quantity: input.quantity, totalPrice, paidAmount: rawPaid, remaining: totalPrice - rawPaid },
  });

  return result!;
}

export async function createItemLedgerEntriesBulk(
  actor: { userId: string; email: string; role: string }, input: BulkItemLedgerInput
): Promise<{ created: number }> {
  let projectId = input.projectId;
  if (actor.role === "site_manager") projectId = (await resolveSiteManagerProjectId(actor.userId, projectId)) ?? "";
  if (!projectId || !mongoose.Types.ObjectId.isValid(projectId)) throw new Error("Project is required");
  const entries = input.entries ?? [];
  const itemIds = [...new Set(entries.map((e) => e.itemId))].filter((id) => mongoose.Types.ObjectId.isValid(id));
  const vendorIds = [...new Set(entries.map((e) => e.vendorId))].filter((id) => mongoose.Types.ObjectId.isValid(id));
  const [items, vendors] = await Promise.all([
    ConsumableItem.find({ _id: { $in: itemIds }, projectId }).lean(),
    Vendor.find({ _id: { $in: vendorIds }, projectId }).lean(),
  ]);
  const itemMap = new Map(items.map((item) => [item._id.toString(), item]));
  const vendorMap = new Map(vendors.map((vendor) => [vendor._id.toString(), vendor]));
  const rows: { rowIndex: number; message: string }[] = [];
  entries.forEach((entry, rowIndex) => {
    try {
      validateItemLedgerInput(entry);
      if (!itemMap.has(entry.itemId)) throw new Error("Item not found or does not belong to this project");
      if (!vendorMap.has(entry.vendorId)) throw new Error("Vendor not found or does not belong to this project");
    } catch (error) { rows.push({ rowIndex, message: error instanceof Error ? error.message : "Invalid row" }); }
  });
  if (rows.length) throw new BulkItemValidationError(rows);
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      for (const entry of entries) await applyItemLedgerEntry(session, entry, itemMap.get(entry.itemId)!, vendorMap.get(entry.vendorId)!);
    });
  } finally { await session.endSession(); }
  const actorUser = await User.findById(actor.userId).lean();
  await logAudit({
    userId: actor.userId, userName: actorUser?.name ?? "Unknown", userEmail: actor.email,
    role: roleDisplay[actor.role as keyof typeof roleDisplay] ?? actor.role, action: "create",
    module: "item_ledger", projectId, projectName: await getProjectName(projectId),
    description: `Bulk purchase: ${entries.length} entries`, newValue: { count: entries.length },
  });
  return { created: entries.length };
}

/** Edit ledger entry: reverse old deltas, apply new deltas — transactional. */
export async function updateItemLedgerEntry(
  actor: { userId: string; email: string; role: string },
  id: string,
  input: UpdateItemLedgerInput
): Promise<ItemLedgerPayload> {
  if (!mongoose.Types.ObjectId.isValid(id)) throw new Error("Invalid ledger entry ID");

  const existing = await ItemLedgerEntry.findById(id).lean();
  if (!existing) throw new Error("Ledger entry not found");

  if (input.quantity != null && input.quantity <= 0) throw new Error("Quantity must be greater than 0");
  const newQuantity = input.quantity != null ? normalizeQuantity(input.quantity) : existing.quantity;
  if (input.unit !== undefined && !input.unit.trim()) throw new Error("Unit is required");
  const newUnitPrice = input.unitPrice ?? existing.unitPrice;
  const newTotalPrice = newQuantity * newUnitPrice;
  // Original raw paid amount typed at entry time, reconstructed: paidAmount is capped at
  // totalPrice, advanceGenerated holds whatever exceeded it.
  const existingRawPaid = existing.paidAmount + (existing.advanceGenerated ?? 0);
  const rawPaid = input.paidAmount ?? existingRawPaid;
  const newPaidAmount = Math.min(rawPaid, newTotalPrice);
  const newRemaining = newTotalPrice - newPaidAmount;
  const newAdvanceGenerated = Math.max(0, rawPaid - newTotalPrice);

  const newVendorId = input.vendorId ?? existing.vendorId.toString();
  if (!mongoose.Types.ObjectId.isValid(newVendorId)) throw new Error("Invalid vendor ID");

  // If this edit would reduce the advance it previously generated (or move it to a different
  // vendor), that advance must not have already been spent elsewhere.
  const advanceDrop = (existing.advanceGenerated ?? 0) - (newVendorId === existing.vendorId.toString() ? newAdvanceGenerated : 0);
  if (advanceDrop > 0) {
    const vendor = await Vendor.findById(existing.vendorId).select("advanceBalance").lean();
    if (!vendor || advanceDrop > vendor.advanceBalance) {
      throw new Error(
        `Cannot reduce this entry's advance: some of the ${(existing.advanceGenerated ?? 0).toLocaleString()} advance it generated has already been applied elsewhere. Reverse that first.`
      );
    }
  }

  const session = await mongoose.startSession();
  let result: ItemLedgerPayload;
  try {
    await session.withTransaction(async () => {
      // Reverse old deltas on item
      await ConsumableItem.findByIdAndUpdate(
        existing.itemId,
        {
          $inc: {
            currentStock: -existing.quantity,
            totalPurchased: -existing.quantity,
            totalAmount: -existing.totalPrice,
            totalPaid: -existing.paidAmount,
            totalPending: -existing.remaining,
          },
        },
        { session }
      );

      // Reverse old deltas on original vendor
      await Vendor.findByIdAndUpdate(
        existing.vendorId,
        {
          $inc: {
            totalBilled: -existing.totalPrice,
            totalPaid: -existingRawPaid,
            remaining: -existing.remaining,
            advanceBalance: -(existing.advanceGenerated ?? 0),
          },
        },
        { session }
      );

      // Apply new deltas on item
      await ConsumableItem.findByIdAndUpdate(
        existing.itemId,
        {
          $inc: {
            currentStock: newQuantity,
            totalPurchased: newQuantity,
            totalAmount: newTotalPrice,
            totalPaid: newPaidAmount,
            totalPending: newRemaining,
          },
        },
        { session }
      );

      // Apply new deltas on (potentially new) vendor
      await Vendor.findByIdAndUpdate(
        newVendorId,
        {
          $inc: {
            totalBilled: newTotalPrice,
            totalPaid: rawPaid,
            remaining: newRemaining,
            advanceBalance: newAdvanceGenerated,
          },
        },
        { session }
      );

      const updates: Record<string, unknown> = {
        quantity: newQuantity,
        unit: input.unit?.trim() || existing.unit,
        unitPrice: newUnitPrice,
        totalPrice: newTotalPrice,
        paidAmount: newPaidAmount,
        remaining: newRemaining,
        advanceGenerated: newAdvanceGenerated,
        vendorId: newVendorId,
      };
      if (input.date) updates.date = input.date;
      if (input.biltyNumber !== undefined) updates.biltyNumber = input.biltyNumber?.trim() || undefined;
      if (input.vehicleNumber !== undefined) updates.vehicleNumber = input.vehicleNumber?.trim() || undefined;
      if (input.paymentMethod) updates.paymentMethod = input.paymentMethod;
      if (input.referenceId !== undefined) updates.referenceId = input.referenceId?.trim() || undefined;
      if (input.remarks !== undefined) updates.remarks = input.remarks?.trim() || undefined;

      const updated = await ItemLedgerEntry.findByIdAndUpdate(id, updates, { new: true, session }).lean();
      if (!updated) throw new Error("Update failed");
      result = await buildPayload(updated);
    });
  } finally {
    session.endSession();
  }

  const fifoMap = await getFifoAllocationForVendor(result!.vendorId);
  const alloc = fifoMap.get(result!.id);
  if (alloc) {
    result!.paidAmount = alloc.allocatedPaid;
    result!.remaining = alloc.allocatedRemaining;
  }

  const actorUser = await User.findById(actor.userId).lean();
  const role = roleDisplay[actor.role as keyof typeof roleDisplay] ?? actor.role;
  await logAudit({
    userId: actor.userId,
    userName: actorUser?.name ?? "Unknown",
    userEmail: actor.email,
    role,
    action: "update",
    module: "item_ledger",
    entityId: id,
    projectId: existing.projectId?.toString(),
    projectName: await getProjectName(existing.projectId?.toString()),
    description: `Updated ledger entry`,
    oldValue: { quantity: existing.quantity, totalPrice: existing.totalPrice, paidAmount: existing.paidAmount },
    newValue: { quantity: newQuantity, totalPrice: newTotalPrice, paidAmount: newPaidAmount },
  });

  return result!;
}

/** Delete ledger entry: reverse all deltas on item and vendor — transactional. */
export async function deleteItemLedgerEntry(
  actor: { userId: string; email: string; role: string },
  id: string
): Promise<void> {
  if (!mongoose.Types.ObjectId.isValid(id)) throw new Error("Invalid ledger entry ID");

  const existing = await ItemLedgerEntry.findById(id).lean();
  if (!existing) throw new Error("Ledger entry not found");

  const item = await ConsumableItem.findById(existing.itemId).select("currentStock name unit").lean();
  if (!item) throw new Error("Item not found");
  if (item.currentStock - existing.quantity < 0) {
    throw new Error(
      `Cannot delete this ledger entry: it would make stock negative. Current stock for "${item.name}" is ${item.currentStock}; this entry adds ${existing.quantity}. Delete or reduce stock consumption first.`
    );
  }

  if ((existing.advanceGenerated ?? 0) > 0) {
    const vendor = await Vendor.findById(existing.vendorId).select("advanceBalance").lean();
    if (!vendor || (existing.advanceGenerated ?? 0) > vendor.advanceBalance) {
      throw new Error(
        `Cannot delete this ledger entry: some of the ${(existing.advanceGenerated ?? 0).toLocaleString()} advance it generated has already been applied elsewhere. Reverse that first.`
      );
    }
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await ConsumableItem.findByIdAndUpdate(
        existing.itemId,
        {
          $inc: {
            currentStock: -existing.quantity,
            totalPurchased: -existing.quantity,
            totalAmount: -existing.totalPrice,
            totalPaid: -existing.paidAmount,
            totalPending: -existing.remaining,
          },
        },
        { session }
      );

      await Vendor.findByIdAndUpdate(
        existing.vendorId,
        {
          $inc: {
            totalBilled: -existing.totalPrice,
            totalPaid: -(existing.paidAmount + (existing.advanceGenerated ?? 0)),
            remaining: -existing.remaining,
            advanceBalance: -(existing.advanceGenerated ?? 0),
          },
        },
        { session }
      );

      await ItemLedgerEntry.findByIdAndDelete(id, { session });
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
    module: "item_ledger",
    entityId: id,
    projectId: existing.projectId?.toString(),
    projectName: await getProjectName(existing.projectId?.toString()),
    description: `Deleted ledger entry`,
    oldValue: { quantity: existing.quantity, totalPrice: existing.totalPrice },
  });
}
