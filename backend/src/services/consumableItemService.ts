import mongoose from "mongoose";
import { ConsumableItem } from "../models/ConsumableItem.js";
import { ItemLedgerEntry } from "../models/ItemLedgerEntry.js";
import { StockConsumptionEntry } from "../models/StockConsumptionEntry.js";
import { CustomerSaleEntry } from "../models/CustomerSaleEntry.js";
import { User } from "../models/User.js";
import { resolveSiteManagerProjectId } from "./projectAccessService.js";
import { logAudit, getProjectName } from "./auditService.js";
import { roleDisplay } from "./authService.js";
import { getFifoAllocationForVendorsBulk } from "./fifoAllocation.js";
import { findDieselItem } from "./dieselService.js";

export interface ConsumableItemPayload {
  id: string;
  projectId: string;
  name: string;
  /** Legacy item-level unit; units now belong to individual movements. */
  unit?: string;
  currentStock: number;
  totalPurchased: number;
  totalAmount: number;
  totalPaid: number;
  totalPending: number;
}

export interface CreateConsumableItemInput {
  projectId: string;
  name: string;
  unit?: string;
}

export interface UpdateConsumableItemInput {
  name?: string;
  unit?: string;
}

function toPayload(doc: {
  _id: mongoose.Types.ObjectId;
  projectId: mongoose.Types.ObjectId;
  name: string;
  unit?: string;
  currentStock?: number;
  totalPurchased?: number;
  totalAmount?: number;
  totalPaid?: number;
  totalPending?: number;
}): ConsumableItemPayload {
  return {
    id: doc._id.toString(),
    projectId: doc.projectId?.toString() ?? "",
    name: doc.name,
    unit: doc.unit,
    currentStock: doc.currentStock ?? 0,
    totalPurchased: doc.totalPurchased ?? 0,
    totalAmount: doc.totalAmount ?? 0,
    totalPaid: doc.totalPaid ?? 0,
    totalPending: doc.totalPending ?? 0,
  };
}

export async function listConsumableItems(
  actor: { userId: string; role: string },
  projectIdParam?: string
): Promise<ConsumableItemPayload[]> {
  let projectId: string | undefined;
  if (actor.role === "site_manager") {
    projectId = await resolveSiteManagerProjectId(actor.userId, projectIdParam);
    if (!projectId) return [];
  } else {
    projectId = projectIdParam;
  }
  const query =
    projectId && mongoose.Types.ObjectId.isValid(projectId) ? { projectId } : {};
  const docs = await ConsumableItem.find(query).sort({ name: 1 }).lean();
  if (docs.length === 0) return [];
  const itemIds = docs.map((d) => d._id);
  const entries = await ItemLedgerEntry.find({ itemId: { $in: itemIds } }).lean();
  if (entries.length === 0) return docs.map(toPayload);
  const vendorIds = [...new Set(entries.map((e) => e.vendorId.toString()))];
  const allocationByVendor = await getFifoAllocationForVendorsBulk(vendorIds);
  const itemTotals = new Map<string, { totalPaid: number; totalPending: number }>();
  for (const itemId of itemIds) {
    itemTotals.set(itemId.toString(), { totalPaid: 0, totalPending: 0 });
  }
  for (const e of entries) {
    const alloc = allocationByVendor.get(e.vendorId.toString())?.get(e._id.toString());
    if (alloc) {
      const t = itemTotals.get(e.itemId.toString());
      if (t) {
        t.totalPaid += alloc.allocatedPaid;
        t.totalPending += alloc.allocatedRemaining;
      }
    }
  }
  return docs.map((d) => {
    const payload = toPayload(d);
    const over = itemTotals.get(d._id.toString());
    if (over) {
      payload.totalPaid = over.totalPaid;
      payload.totalPending = over.totalPending;
    }
    return payload;
  });
}

export async function getConsumableItemById(id: string): Promise<ConsumableItemPayload | null> {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const doc = await ConsumableItem.findById(id).lean();
  if (!doc) return null;
  const entries = await ItemLedgerEntry.find({ itemId: id }).lean();
  if (entries.length === 0) return toPayload(doc);
  const vendorIds = [...new Set(entries.map((e) => e.vendorId.toString()))];
  const allocationByVendor = await getFifoAllocationForVendorsBulk(vendorIds);
  let totalPaid = 0;
  let totalPending = 0;
  for (const e of entries) {
    const alloc = allocationByVendor.get(e.vendorId.toString())?.get(e._id.toString());
    if (alloc) {
      totalPaid += alloc.allocatedPaid;
      totalPending += alloc.allocatedRemaining;
    }
  }
  const payload = toPayload(doc);
  payload.totalPaid = totalPaid;
  payload.totalPending = totalPending;
  return payload;
}

export async function getDieselItem(
  actor: { userId: string; role: string }, projectIdParam?: string
): Promise<ConsumableItemPayload | null> {
  let projectId = projectIdParam;
  if (actor.role === "site_manager") projectId = await resolveSiteManagerProjectId(actor.userId, projectIdParam);
  if (!projectId || !mongoose.Types.ObjectId.isValid(projectId)) return null;
  const item = await findDieselItem(projectId);
  return item ? toPayload(item) : null;
}

export async function createConsumableItem(
  actor: { userId: string; email: string; role: string },
  input: CreateConsumableItemInput
): Promise<ConsumableItemPayload> {
  if (!input.name?.trim()) throw new Error("Item name is required");

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

  const existing = await ConsumableItem.findOne({
    projectId,
    name: { $regex: new RegExp(`^${input.name.trim()}$`, "i") },
  });
  if (existing) throw new Error(`An item named "${input.name.trim()}" already exists in this project`);

  const item = await ConsumableItem.create({
    projectId,
    name: input.name.trim(),
    unit: "",
    currentStock: 0,
    totalPurchased: 0,
    totalAmount: 0,
    totalPaid: 0,
    totalPending: 0,
  });

  const actorUser = await User.findById(actor.userId).lean();
  const role = roleDisplay[actor.role as keyof typeof roleDisplay] ?? actor.role;
  await logAudit({
    userId: actor.userId,
    userName: actorUser?.name ?? "Unknown",
    userEmail: actor.email,
    role,
    action: "create",
    module: "consumable_items",
    entityId: item._id.toString(),
    projectId: item.projectId?.toString(),
    projectName: await getProjectName(item.projectId?.toString()),
    description: `Created consumable item: ${item.name}`,
    newValue: { name: item.name },
  });

  return toPayload(item);
}

export async function updateConsumableItem(
  actor: { userId: string; email: string; role: string },
  id: string,
  input: UpdateConsumableItemInput
): Promise<ConsumableItemPayload> {
  if (!mongoose.Types.ObjectId.isValid(id)) throw new Error("Invalid item ID");

  const target = await ConsumableItem.findById(id);
  if (!target) throw new Error("Item not found");

  if (input.name != null) {
    const name = input.name.trim();
    if (!name) throw new Error("Item name cannot be empty");
    const conflict = await ConsumableItem.findOne({
      projectId: target.projectId,
      name: { $regex: new RegExp(`^${name}$`, "i") },
      _id: { $ne: id },
    });
    if (conflict) throw new Error(`An item named "${name}" already exists in this project`);
  }

  const updates: Record<string, unknown> = {};
  if (input.name != null) updates.name = input.name.trim();

  const updated = await ConsumableItem.findByIdAndUpdate(id, updates, { new: true }).lean();
  if (!updated) throw new Error("Update failed");

  const actorUser = await User.findById(actor.userId).lean();
  const role = roleDisplay[actor.role as keyof typeof roleDisplay] ?? actor.role;
  await logAudit({
    userId: actor.userId,
    userName: actorUser?.name ?? "Unknown",
    userEmail: actor.email,
    role,
    action: "update",
    module: "consumable_items",
    entityId: id,
    projectId: target.projectId?.toString(),
    projectName: await getProjectName(target.projectId?.toString()),
    description: `Updated consumable item: ${target.name}`,
    oldValue: { name: target.name },
    newValue: { name: updated.name },
  });

  return toPayload(updated);
}

export async function deleteConsumableItem(
  actor: { userId: string; email: string; role: string },
  id: string
): Promise<void> {
  if (!mongoose.Types.ObjectId.isValid(id)) throw new Error("Invalid item ID");

  const target = await ConsumableItem.findById(id);
  if (!target) throw new Error("Item not found");

  const [ledgerCount, consumptionCount, saleCount] = await Promise.all([
    ItemLedgerEntry.countDocuments({ itemId: id }),
    StockConsumptionEntry.countDocuments({ "items.itemId": id }),
    CustomerSaleEntry.countDocuments({ itemId: id }),
  ]);

  if (ledgerCount > 0 || consumptionCount > 0 || saleCount > 0) {
    const parts: string[] = [];
    if (ledgerCount > 0) parts.push(`${ledgerCount} ledger entr${ledgerCount === 1 ? "y" : "ies"}`);
    if (consumptionCount > 0) parts.push(`${consumptionCount} consumption entr${consumptionCount === 1 ? "y" : "ies"}`);
    if (saleCount > 0) parts.push(`${saleCount} customer sale entr${saleCount === 1 ? "y" : "ies"}`);
    throw new Error(`Cannot delete "${target.name}": referenced in ${parts.join(" and ")}`);
  }

  await ConsumableItem.findByIdAndDelete(id);

  const actorUser = await User.findById(actor.userId).lean();
  const role = roleDisplay[actor.role as keyof typeof roleDisplay] ?? actor.role;
  await logAudit({
    userId: actor.userId,
    userName: actorUser?.name ?? "Unknown",
    userEmail: actor.email,
    role,
    action: "delete",
    module: "consumable_items",
    entityId: id,
    projectId: target.projectId?.toString(),
    projectName: await getProjectName(target.projectId?.toString()),
    description: `Deleted consumable item: ${target.name}`,
    oldValue: { name: target.name },
  });
}
