import mongoose from "mongoose";
import { Machine } from "../models/Machine.js";
import { MachineLedgerEntry } from "../models/MachineLedgerEntry.js";
import { MachinePayment } from "../models/MachinePayment.js";
import { MachinePaymentAllocation } from "../models/MachinePaymentAllocation.js";
import { StockConsumptionEntry } from "../models/StockConsumptionEntry.js";
import { ConsumableItem } from "../models/ConsumableItem.js";
import { User } from "../models/User.js";
import { logAudit, getProjectName } from "./auditService.js";
import { roleDisplay } from "./authService.js";
import { resolveSiteManagerProjectId } from "./projectAccessService.js";

export interface MachinePayload {
  id: string;
  projectId: string;
  name: string;
  ownership: "Company Owned" | "Rented";
  hourlyRate: number;
}

export interface MachineTotals {
  totalDiesel: number;
  totalHours: number;
  totalCost: number;
  totalPaid: number;
  remaining: number;
  /** Overpayment held by the machine owner — max(0, totalPaid - totalCost). The mirror image of
   *  `remaining`: money we have already handed over that no billed hours have consumed yet. */
  totalAdvance: number;
}

export interface MachineWithTotals extends MachinePayload {
  totalDiesel: number;
  totalHours: number;
  totalCost: number;
  totalPaid: number;
  totalPending: number; // alias for remaining (frontend uses totalPending)
  /** Unconsumed advance sitting with the owner (receivable side). */
  totalAdvance: number;
}

export interface CreateMachineInput {
  projectId?: string;
  name: string;
  ownership: "Company Owned" | "Rented";
  hourlyRate: number;
}

export interface UpdateMachineInput {
  name?: string;
  hourlyRate?: number;
}

const DEFAULT_PAGE_SIZE = 12;
const MAX_PAGE_SIZE = 100;

function toPayload(doc: {
  _id: mongoose.Types.ObjectId;
  projectId: mongoose.Types.ObjectId;
  name: string;
  ownership: string;
  hourlyRate: number;
}): MachinePayload {
  return {
    id: doc._id.toString(),
    projectId: doc.projectId?.toString() ?? "",
    name: doc.name,
    ownership: doc.ownership as "Company Owned" | "Rented",
    hourlyRate: doc.hourlyRate,
  };
}

/** Resolve projectId for actor. Site Manager uses assigned project; Admin/Super Admin use param. */
async function resolveProjectId(
  actor: { userId: string; role: string },
  projectIdParam?: string
): Promise<string | undefined> {
  if (actor.role === "site_manager") {
    return resolveSiteManagerProjectId(actor.userId, projectIdParam);
  }
  return projectIdParam;
}

export interface MachineTotalsOptions {
  /** Inclusive "YYYY-MM-DD" range. When provided, totals are computed only from ledger entries and
   *  payments dated within the range instead of the machine's all-time history. */
  startDate?: string;
  endDate?: string;
}

/** Compute machine totals from ledger entries and payments (all-time, or within a date range). */
export async function getMachineTotals(machineId: string, options?: MachineTotalsOptions): Promise<MachineTotals> {
  if (!mongoose.Types.ObjectId.isValid(machineId)) {
    return { totalDiesel: 0, totalHours: 0, totalCost: 0, totalPaid: 0, remaining: 0, totalAdvance: 0 };
  }
  const machineObjId = new mongoose.Types.ObjectId(machineId);
  const startDate = options?.startDate?.trim() || undefined;
  const endDate = options?.endDate?.trim() || undefined;
  const dateMatch: Record<string, unknown> = {};
  if (startDate || endDate) {
    dateMatch.date = {
      ...(startDate && { $gte: startDate }),
      ...(endDate && { $lte: endDate }),
    };
  }
  const [entryAgg, paymentSum, dieselSum] = await Promise.all([
    MachineLedgerEntry.aggregate<{ totalHours: number; totalCost: number }>([
      { $match: { machineId: machineObjId, ...dateMatch } },
      { $group: { _id: null, totalHours: { $sum: "$hoursWorked" }, totalCost: { $sum: "$totalCost" } } },
    ]).then((r) => r[0] ?? { totalHours: 0, totalCost: 0 }),
    MachinePayment.aggregate([{ $match: { machineId: machineObjId, ...dateMatch } }, { $group: { _id: null, total: { $sum: "$amount" } } }]).then(
      (r) => r[0]?.total ?? 0
    ),
    StockConsumptionEntry.aggregate([
      { $match: { machineId: machineObjId, ...dateMatch } },
      { $unwind: "$items" },
      { $group: { _id: null, total: { $sum: "$items.quantityUsed" } } },
    ]).then((r) => r[0]?.total ?? 0),
  ]);
  const totalCost = entryAgg.totalCost;
  const totalPaid = paymentSum;
  const remaining = Math.max(0, totalCost - totalPaid);
  const totalAdvance = Math.max(0, totalPaid - totalCost);
  return {
    totalDiesel: dieselSum,
    totalHours: entryAgg.totalHours,
    totalCost,
    totalPaid,
    remaining,
    totalAdvance,
  };
}

export interface ListMachinesResult {
  items: MachineWithTotals[];
  total: number;
}

/** One row per machine for a dated running bill (period = inclusive YYYY-MM-DD range).
 * Payments are bucketed the same way as ledger entries: before periodStart → previousBillAdvance,
 * from periodStart through periodEnd → thisBillAdvance. The frontend decides which machines count
 * toward the printed total (a selection checkbox), so each row carries its own split figures
 * rather than the service pre-summing everything. */
export interface MachineRunningBillRow extends MachinePayload {
  currentHours: number;
  previousHours: number;
  totalHours: number;
  thisBill: number;
  previousBill: number;
  totalAmount: number;
  previousBillAdvance: number;
  thisBillAdvance: number;
}

/** Column totals for the entire project (all machines), same period rules as rows. */
export interface RunningBillSummary {
  currentHours: number;
  previousHours: number;
  totalHours: number;
  thisBill: number;
  previousBill: number;
  totalAmount: number;
  previousBillAdvance: number;
  thisBillAdvance: number;
}

export interface ListMachinesRunningBillResult {
  items: MachineRunningBillRow[];
  total: number;
  periodStart: string;
  periodEnd: string;
  summary: RunningBillSummary;
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Ledger entries before periodStart → previous hours/bill; entries from periodStart through periodEnd → current/this bill.
 * Entries after periodEnd are excluded. Advance = sum of payments on that machine with date ≤ periodEnd.
 */
export async function listMachinesRunningBill(
  actor: { userId: string; role: string },
  params: {
    projectId?: string;
    periodStart: string;
    periodEnd: string;
    page?: number;
    pageSize?: number;
  }
): Promise<ListMachinesRunningBillResult> {
  const { periodStart, periodEnd } = params;
  if (!YMD_RE.test(periodStart) || !YMD_RE.test(periodEnd)) {
    throw new Error("periodStart and periodEnd must be YYYY-MM-DD");
  }
  if (periodStart > periodEnd) {
    throw new Error("periodStart must be on or before periodEnd");
  }

  const projectId = await resolveProjectId(actor, params.projectId);
  const emptySummary: RunningBillSummary = {
    currentHours: 0,
    previousHours: 0,
    totalHours: 0,
    thisBill: 0,
    previousBill: 0,
    totalAmount: 0,
    previousBillAdvance: 0,
    thisBillAdvance: 0,
  };

  if (actor.role === "site_manager" && !projectId) {
    return { items: [], total: 0, periodStart, periodEnd, summary: emptySummary };
  }
  if (!projectId || !mongoose.Types.ObjectId.isValid(projectId)) {
    return { items: [], total: 0, periodStart, periodEnd, summary: emptySummary };
  }

  const projectObjId = new mongoose.Types.ObjectId(projectId);
  const pageSize = Math.min(Math.max(1, params.pageSize ?? DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
  const page = params.page !== undefined ? Math.max(1, Number(params.page)) : 1;
  const skip = (page - 1) * pageSize;

  const [docs, total] = await Promise.all([
    Machine.find({ projectId: projectObjId }).sort({ name: 1 }).skip(skip).limit(pageSize).lean(),
    Machine.countDocuments({ projectId: projectObjId }),
  ]);

  const bucketStages = [
    {
      $addFields: {
        bucket: {
          $switch: {
            branches: [
              { case: { $lt: ["$date", periodStart] }, then: "previous" },
              {
                case: {
                  $and: [{ $gte: ["$date", periodStart] }, { $lte: ["$date", periodEnd] }],
                },
                then: "current",
              },
            ],
            default: "ignore",
          },
        },
      },
    },
    { $match: { bucket: { $ne: "ignore" } } },
  ] as const;

  const [globalEntryBuckets, globalPaymentBuckets] = await Promise.all([
    MachineLedgerEntry.aggregate<{ _id: string; hours: number; cost: number }>([
      { $match: { projectId: projectObjId } },
      ...bucketStages,
      { $group: { _id: "$bucket", hours: { $sum: "$hoursWorked" }, cost: { $sum: "$totalCost" } } },
    ]),
    (async () => {
      const allIds = await Machine.find({ projectId: projectObjId }).distinct("_id");
      if (allIds.length === 0) return [] as { _id: string; total: number }[];
      return MachinePayment.aggregate<{ _id: string; total: number }>([
        { $match: { machineId: { $in: allIds } } },
        ...bucketStages,
        { $group: { _id: "$bucket", total: { $sum: "$amount" } } },
      ]);
    })(),
  ]);

  let prevH = 0;
  let currH = 0;
  let prevC = 0;
  let currC = 0;
  for (const row of globalEntryBuckets) {
    if (row._id === "previous") {
      prevH = row.hours;
      prevC = row.cost;
    } else if (row._id === "current") {
      currH = row.hours;
      currC = row.cost;
    }
  }
  let prevAdvance = 0;
  let currAdvance = 0;
  for (const row of globalPaymentBuckets) {
    if (row._id === "previous") prevAdvance = row.total;
    else if (row._id === "current") currAdvance = row.total;
  }
  const totalAmt = prevC + currC;
  const summary: RunningBillSummary = {
    currentHours: currH,
    previousHours: prevH,
    totalHours: prevH + currH,
    thisBill: currC,
    previousBill: prevC,
    totalAmount: totalAmt,
    previousBillAdvance: prevAdvance,
    thisBillAdvance: currAdvance,
  };

  if (docs.length === 0) {
    return { items: [], total, periodStart, periodEnd, summary };
  }

  const machineObjIds = docs.map((d) => d._id);

  const [entryBuckets, paymentBuckets] = await Promise.all([
    MachineLedgerEntry.aggregate<{
      _id: { m: mongoose.Types.ObjectId; b: string };
      hours: number;
      cost: number;
    }>([
      {
        $match: {
          machineId: { $in: machineObjIds },
          projectId: projectObjId,
        },
      },
      {
        $addFields: {
          bucket: {
            $switch: {
              branches: [
                { case: { $lt: ["$date", periodStart] }, then: "previous" },
                {
                  case: {
                    $and: [{ $gte: ["$date", periodStart] }, { $lte: ["$date", periodEnd] }],
                  },
                  then: "current",
                },
              ],
              default: "ignore",
            },
          },
        },
      },
      { $match: { bucket: { $ne: "ignore" } } },
      {
        $group: {
          _id: { m: "$machineId", b: "$bucket" },
          hours: { $sum: "$hoursWorked" },
          cost: { $sum: "$totalCost" },
        },
      },
    ]),
    MachinePayment.aggregate<{ _id: { m: mongoose.Types.ObjectId; b: string }; total: number }>([
      { $match: { machineId: { $in: machineObjIds } } },
      {
        $addFields: {
          bucket: {
            $switch: {
              branches: [
                { case: { $lt: ["$date", periodStart] }, then: "previous" },
                {
                  case: {
                    $and: [{ $gte: ["$date", periodStart] }, { $lte: ["$date", periodEnd] }],
                  },
                  then: "current",
                },
              ],
              default: "ignore",
            },
          },
        },
      },
      { $match: { bucket: { $ne: "ignore" } } },
      { $group: { _id: { m: "$machineId", b: "$bucket" }, total: { $sum: "$amount" } } },
    ]),
  ]);

  const bucketMap = new Map<string, { previous: { h: number; c: number }; current: { h: number; c: number } }>();
  for (const d of docs) {
    bucketMap.set(d._id.toString(), {
      previous: { h: 0, c: 0 },
      current: { h: 0, c: 0 },
    });
  }
  for (const row of entryBuckets) {
    const mid = row._id.m.toString();
    const b = row._id.b;
    const existing = bucketMap.get(mid);
    if (!existing) continue;
    if (b === "previous") {
      existing.previous.h = row.hours;
      existing.previous.c = row.cost;
    } else if (b === "current") {
      existing.current.h = row.hours;
      existing.current.c = row.cost;
    }
  }

  const payMap = new Map<string, { previous: number; current: number }>();
  for (const p of paymentBuckets) {
    const mid = p._id.m.toString();
    const existing = payMap.get(mid) ?? { previous: 0, current: 0 };
    if (p._id.b === "previous") existing.previous = p.total;
    else if (p._id.b === "current") existing.current = p.total;
    payMap.set(mid, existing);
  }

  const items: MachineRunningBillRow[] = docs.map((doc) => {
    const idStr = doc._id.toString();
    const b = bucketMap.get(idStr)!;
    const previousHours = b.previous.h;
    const currentHours = b.current.h;
    const totalHours = previousHours + currentHours;
    const previousBill = b.previous.c;
    const thisBill = b.current.c;
    const totalAmount = previousBill + thisBill;
    const pay = payMap.get(idStr) ?? { previous: 0, current: 0 };
    return {
      ...toPayload(doc),
      currentHours,
      previousHours,
      totalHours,
      thisBill,
      previousBill,
      totalAmount,
      previousBillAdvance: pay.previous,
      thisBillAdvance: pay.current,
    };
  });

  return { items, total, periodStart, periodEnd, summary };
}

/** List machines for a project with server-side pagination. Site Manager: uses assigned project.
 *  Pass startDate/endDate to compute totals within that inclusive date range instead of all-time. */
export async function listMachines(
  actor: { userId: string; role: string },
  params: { projectId?: string; page?: number; pageSize?: number; startDate?: string; endDate?: string }
): Promise<ListMachinesResult> {
  const projectId = await resolveProjectId(actor, params.projectId);
  if (actor.role === "site_manager" && !projectId) return { items: [], total: 0 };

  const pageSize = Math.min(Math.max(1, params.pageSize ?? DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
  const page = params.page !== undefined ? Math.max(1, Number(params.page)) : 1;
  const skip = (page - 1) * pageSize;

  const filter: Record<string, unknown> = {};
  if (projectId && mongoose.Types.ObjectId.isValid(projectId)) {
    filter.projectId = new mongoose.Types.ObjectId(projectId);
  }

  const [docs, total] = await Promise.all([
    Machine.find(filter).sort({ name: 1 }).skip(skip).limit(pageSize).lean(),
    Machine.countDocuments(filter),
  ]);

  const items: MachineWithTotals[] = [];
  for (const doc of docs) {
    const totals = await getMachineTotals(doc._id.toString(), { startDate: params.startDate, endDate: params.endDate });
    items.push({
      ...toPayload(doc),
      totalDiesel: totals.totalDiesel,
      totalHours: totals.totalHours,
      totalCost: totals.totalCost,
      totalPaid: totals.totalPaid,
      totalPending: totals.remaining,
      totalAdvance: totals.totalAdvance,
    });
  }
  return { items, total };
}

export async function getMachineById(id: string): Promise<MachineWithTotals | null> {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const doc = await Machine.findById(id).lean();
  if (!doc) return null;
  const totals = await getMachineTotals(id);
  return {
    ...toPayload(doc),
    totalDiesel: totals.totalDiesel,
    totalHours: totals.totalHours,
    totalCost: totals.totalCost,
    totalPaid: totals.totalPaid,
    totalPending: totals.remaining,
    totalAdvance: totals.totalAdvance,
  };
}

/** Create machine. Site Manager: uses assigned project. Admin/Super Admin: require projectId in input. */
export async function createMachine(
  actor: { userId: string; email: string; role: string },
  input: CreateMachineInput
): Promise<MachinePayload> {
  if (!input.name?.trim()) throw new Error("Machine name is required");
  const rate = Number(input.hourlyRate);
  if (isNaN(rate) || rate < 0) throw new Error("Hourly rate must be a non-negative number");

  let projectId: string;
  if (actor.role === "site_manager") {
    projectId = (await resolveSiteManagerProjectId(actor.userId, input.projectId?.trim())) ?? "";
    if (!projectId) throw new Error("Site Manager must be assigned to this project to add machines");
  } else {
    projectId = input.projectId?.trim() ?? "";
    if (!projectId || !mongoose.Types.ObjectId.isValid(projectId)) {
      throw new Error("Valid project is required");
    }
  }

  const doc = await Machine.create({
    name: input.name.trim(),
    ownership: input.ownership,
    hourlyRate: rate,
    projectId,
  });

  const actorUser = await User.findById(actor.userId).lean();
  const role = roleDisplay[actor.role as keyof typeof roleDisplay] ?? actor.role;
  await logAudit({
    userId: actor.userId,
    userName: actorUser?.name ?? "Unknown",
    userEmail: actor.email,
    role,
    action: "create",
    module: "machinery",
    entityId: doc._id.toString(),
    projectId: projectId,
    projectName: await getProjectName(projectId),
    description: `Added machine: ${doc.name}`,
    newValue: { name: doc.name, hourlyRate: doc.hourlyRate },
  });

  return toPayload(doc);
}

/** Update machine. Only name and hourlyRate; existing ledger entries keep their stored totalCost. */
export async function updateMachine(
  actor: { userId: string; email: string; role: string },
  id: string,
  input: UpdateMachineInput
): Promise<MachinePayload> {
  if (!mongoose.Types.ObjectId.isValid(id)) throw new Error("Invalid machine ID");

  const target = await Machine.findById(id);
  if (!target) throw new Error("Machine not found");

  const updates: { name?: string; hourlyRate?: number } = {};
  if (input.name !== undefined) {
    if (!input.name?.trim()) throw new Error("Machine name cannot be empty");
    updates.name = input.name.trim();
  }
  if (input.hourlyRate !== undefined) {
    const rate = Number(input.hourlyRate);
    if (isNaN(rate) || rate < 0) throw new Error("Hourly rate must be a non-negative number");
    updates.hourlyRate = rate;
  }
  if (Object.keys(updates).length === 0) return toPayload(target);

  const updated = await Machine.findByIdAndUpdate(id, { $set: updates }, { new: true }).lean();
  if (!updated) throw new Error("Machine not found");

  const actorUser = await User.findById(actor.userId).lean();
  const role = roleDisplay[actor.role as keyof typeof roleDisplay] ?? actor.role;
  await logAudit({
    userId: actor.userId,
    userName: actorUser?.name ?? "Unknown",
    userEmail: actor.email,
    role,
    action: "update",
    module: "machinery",
    entityId: id,
    projectId: target.projectId?.toString(),
    projectName: await getProjectName(target.projectId?.toString()),
    description: `Updated machine: ${updated.name}`,
    oldValue: { name: target.name, hourlyRate: target.hourlyRate },
    newValue: { name: updated.name, hourlyRate: updated.hourlyRate },
  });

  return toPayload(updated);
}

/** Delete machine. Blocked if machine has any remaining dues. */
export async function deleteMachine(
  actor: { userId: string; email: string; role: string },
  id: string
): Promise<void> {
  if (!mongoose.Types.ObjectId.isValid(id)) throw new Error("Invalid machine ID");

  const target = await Machine.findById(id);
  if (!target) throw new Error("Machine not found");

  const totals = await getMachineTotals(id);
  if (totals.remaining > 0) {
    throw new Error(
      `Cannot delete machine "${target.name}": remaining dues of ${totals.remaining.toLocaleString()} PKR. Clear the dues first.`
    );
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const consumptions = await StockConsumptionEntry.find({ machineId: id }).session(session).lean();
      for (const consumption of consumptions) {
        for (const line of consumption.items) {
          await ConsumableItem.findByIdAndUpdate(line.itemId, { $inc: { currentStock: line.quantityUsed } }, { session });
        }
      }
      await StockConsumptionEntry.deleteMany({ machineId: id }, { session });
      await MachinePaymentAllocation.deleteMany({ machineId: id }, { session });
      await MachinePayment.deleteMany({ machineId: id }, { session });
      await MachineLedgerEntry.deleteMany({ machineId: id }, { session });
      await Machine.findByIdAndDelete(id, { session });
    });
  } finally { await session.endSession(); }

  const actorUser = await User.findById(actor.userId).lean();
  const role = roleDisplay[actor.role as keyof typeof roleDisplay] ?? actor.role;
  await logAudit({
    userId: actor.userId,
    userName: actorUser?.name ?? "Unknown",
    userEmail: actor.email,
    role,
    action: "delete",
    module: "machinery",
    entityId: id,
    projectId: target.projectId?.toString(),
    projectName: await getProjectName(target.projectId?.toString()),
    description: `Deleted machine: ${target.name}`,
    oldValue: { name: target.name },
  });
}
