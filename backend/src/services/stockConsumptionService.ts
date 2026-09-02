import mongoose from "mongoose";
import { StockConsumptionEntry } from "../models/StockConsumptionEntry.js";
import { ConsumableItem } from "../models/ConsumableItem.js";
import { User } from "../models/User.js";
import { resolveSiteManagerProjectId } from "./projectAccessService.js";
import { logAudit, getProjectName } from "./auditService.js";
import { roleDisplay } from "./authService.js";

export interface ConsumptionItemPayload {
  itemId: string;
  itemName: string;
  unit: string;
  quantityUsed: number;
}

export interface StockConsumptionPayload {
  id: string;
  projectId: string;
  machineId?: string;
  date: string;
  remarks?: string;
  items: ConsumptionItemPayload[];
}

export interface CreateConsumptionInput {
  projectId: string;
  date: string;
  remarks?: string;
  items: { itemId: string; unit: string; quantityUsed: number }[];
}

export interface UpdateConsumptionInput {
  date?: string;
  remarks?: string;
  items?: { itemId: string; unit: string; quantityUsed: number }[];
}

/** Quantities follow the same .XX (2-decimal) convention as pricing elsewhere in the app. */
function normalizeQuantity(quantityUsed: number): number {
  if (typeof quantityUsed !== "number" || !Number.isFinite(quantityUsed) || quantityUsed <= 0) {
    throw new Error("Quantity must be a positive number");
  }
  return Math.round(quantityUsed * 100) / 100;
}

function assertUniqueItems(items: { itemId: string; unit: string; quantityUsed: number }[]) {
  const seen = new Set<string>();
  for (const line of items) {
    if (seen.has(line.itemId)) {
      throw new Error("Duplicate item in this consumption entry. Update the existing line instead of adding another.");
    }
    seen.add(line.itemId);
  }
}

async function buildPayload(doc: {
  _id: mongoose.Types.ObjectId;
  projectId: mongoose.Types.ObjectId;
  machineId?: mongoose.Types.ObjectId;
  date: string;
  remarks?: string;
  items: { itemId: mongoose.Types.ObjectId; unit?: string; quantityUsed: number }[];
}): Promise<StockConsumptionPayload> {
  const itemIds = doc.items.map((i) => i.itemId);
  const itemDocs = await ConsumableItem.find({ _id: { $in: itemIds } }).select("name unit").lean();
  const itemMap = new Map(itemDocs.map((i) => [i._id.toString(), i]));

  return {
    id: doc._id.toString(),
    projectId: doc.projectId.toString(),
    machineId: doc.machineId?.toString(),
    date: doc.date,
    remarks: doc.remarks,
    items: doc.items.map((i) => {
      const item = itemMap.get(i.itemId.toString());
      return {
        itemId: i.itemId.toString(),
        itemName: item?.name ?? "Unknown",
        unit: i.unit ?? item?.unit ?? "",
        quantityUsed: i.quantityUsed,
      };
    }),
  };
}

export async function listStockConsumption(
  actor: { userId: string; role: string },
  projectIdParam?: string
): Promise<StockConsumptionPayload[]> {
  let projectId: string | undefined;
  if (actor.role === "site_manager") {
    projectId = await resolveSiteManagerProjectId(actor.userId, projectIdParam);
    if (!projectId) return [];
  } else {
    projectId = projectIdParam;
  }
  const query =
    projectId && mongoose.Types.ObjectId.isValid(projectId) ? { projectId } : {};
  const docs = await StockConsumptionEntry.find(query).sort({ date: -1 }).lean();
  return Promise.all(docs.map(buildPayload));
}

export async function createStockConsumption(
  actor: { userId: string; email: string; role: string },
  input: CreateConsumptionInput
): Promise<StockConsumptionPayload> {
  if (!input.date) throw new Error("Date is required");
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

  const session = await mongoose.startSession();
  let result: StockConsumptionPayload;
  try {
    await session.withTransaction(async () => {
      for (const line of input.items) {
        if (!mongoose.Types.ObjectId.isValid(line.itemId)) throw new Error(`Invalid item ID: ${line.itemId}`);
        line.quantityUsed = normalizeQuantity(line.quantityUsed);
        if (!line.unit?.trim()) throw new Error("Unit is required");
        const item = await ConsumableItem.findOne({ _id: line.itemId, projectId }).session(session).lean();
        if (!item) throw new Error(`Item not found or does not belong to this project: ${line.itemId}`);
        if (item.currentStock < line.quantityUsed) {
          throw new Error(
            `Insufficient stock for "${item.name}": available ${item.currentStock}, requested ${line.quantityUsed}`
          );
        }
      }

      const entry = await StockConsumptionEntry.create(
        [
          {
            projectId,
            date: input.date,
            remarks: input.remarks?.trim() || undefined,
            items: input.items.map((i) => ({ itemId: i.itemId, unit: i.unit.trim(), quantityUsed: i.quantityUsed })),
          },
        ],
        { session }
      );

      for (const line of input.items) {
        await ConsumableItem.findByIdAndUpdate(
          line.itemId,
          { $inc: { currentStock: -line.quantityUsed } },
          { session }
        );
      }

      result = await buildPayload(entry[0]);
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
    module: "stock_consumption",
    entityId: result!.id,
    projectId: projectId,
    projectName: await getProjectName(projectId),
    description: `Recorded stock consumption: ${input.items.length} item(s)`,
    newValue: { items: input.items.length },
  });

  return result!;
}

export async function updateStockConsumption(
  actor: { userId: string; email: string; role: string },
  id: string,
  input: UpdateConsumptionInput
): Promise<StockConsumptionPayload> {
  if (!mongoose.Types.ObjectId.isValid(id)) throw new Error("Invalid consumption entry ID");

  const existing = await StockConsumptionEntry.findById(id).lean();
  if (!existing) throw new Error("Consumption entry not found");
  if (existing.machineId) {
    throw new Error("This diesel consumption is linked to a machine ledger entry; edit it from the machine ledger.");
  }

  const session = await mongoose.startSession();
  let result: StockConsumptionPayload;
  try {
    await session.withTransaction(async () => {
      // Reverse existing stock deductions
      for (const line of existing.items) {
        await ConsumableItem.findByIdAndUpdate(
          line.itemId,
          { $inc: { currentStock: line.quantityUsed } },
          { session }
        );
      }

      const newItems = input.items ?? existing.items.map((i) => ({
        itemId: i.itemId.toString(),
        unit: i.unit ?? "",
        quantityUsed: i.quantityUsed,
      }));
      assertUniqueItems(newItems);

      for (const line of newItems) {
        if (!mongoose.Types.ObjectId.isValid(line.itemId)) throw new Error(`Invalid item ID: ${line.itemId}`);
        line.quantityUsed = normalizeQuantity(line.quantityUsed);
        if (!line.unit?.trim()) throw new Error("Unit is required");
        const item = await ConsumableItem.findById(line.itemId).session(session).lean();
        if (!item) throw new Error(`Item not found: ${line.itemId}`);
        if (item.currentStock < line.quantityUsed) {
          throw new Error(
            `Insufficient stock for "${item.name}": available ${item.currentStock}, requested ${line.quantityUsed}`
          );
        }
      }

      const updates: Record<string, unknown> = {};
      if (input.date) updates.date = input.date;
      if (input.remarks !== undefined) updates.remarks = input.remarks?.trim() || undefined;
      if (input.items) updates.items = newItems.map((i) => ({ itemId: i.itemId, unit: i.unit.trim(), quantityUsed: i.quantityUsed }));

      const updated = await StockConsumptionEntry.findByIdAndUpdate(id, updates, { new: true, session }).lean();
      if (!updated) throw new Error("Update failed");

      for (const line of newItems) {
        await ConsumableItem.findByIdAndUpdate(
          line.itemId,
          { $inc: { currentStock: -line.quantityUsed } },
          { session }
        );
      }

      result = await buildPayload(updated);
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
    action: "update",
    module: "stock_consumption",
    entityId: id,
    projectId: existing.projectId?.toString(),
    projectName: await getProjectName(existing.projectId?.toString()),
    description: `Updated stock consumption entry`,
  });

  return result!;
}

export async function deleteStockConsumption(
  actor: { userId: string; email: string; role: string },
  id: string
): Promise<void> {
  if (!mongoose.Types.ObjectId.isValid(id)) throw new Error("Invalid consumption entry ID");

  const existing = await StockConsumptionEntry.findById(id).lean();
  if (!existing) throw new Error("Consumption entry not found");
  if (existing.machineId) {
    throw new Error("This diesel consumption is linked to a machine ledger entry; edit it from the machine ledger.");
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      for (const line of existing.items) {
        await ConsumableItem.findByIdAndUpdate(
          line.itemId,
          { $inc: { currentStock: line.quantityUsed } },
          { session }
        );
      }
      await StockConsumptionEntry.findByIdAndDelete(id, { session });
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
    module: "stock_consumption",
    entityId: id,
    projectId: existing.projectId?.toString(),
    projectName: await getProjectName(existing.projectId?.toString()),
    description: `Deleted stock consumption entry`,
    oldValue: { date: existing.date, itemCount: existing.items.length },
  });
}
