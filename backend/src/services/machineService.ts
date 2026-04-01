import mongoose from "mongoose";
import { Machine } from "../models/Machine.js";
import { MachineLedgerEntry } from "../models/MachineLedgerEntry.js";
import { MachinePayment } from "../models/MachinePayment.js";
import { MachinePaymentAllocation } from "../models/MachinePaymentAllocation.js";
import { User } from "../models/User.js";
import { logAudit } from "./auditService.js";
import { roleDisplay } from "./authService.js";

export interface MachinePayload {
  id: string;
  projectId: string;
  name: string;
  ownership: "Company Owned" | "Rented";
  hourlyRate: number;
}

export interface MachineTotals {
  totalHours: number;
  totalCost: number;
  totalPaid: number;
  remaining: number;
}

export interface MachineWithTotals extends MachinePayload {
  totalHours: number;
  totalCost: number;
  totalPaid: number;
  totalPending: number; // alias for remaining (frontend uses totalPending)
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
    const user = await User.findById(actor.userId).select("assignedProjectId").lean();
    return user?.assignedProjectId?.toString();
  }
  return projectIdParam;
}

/** Compute machine totals from ledger entries and payments. */
export async function getMachineTotals(machineId: string): Promise<MachineTotals> {
  if (!mongoose.Types.ObjectId.isValid(machineId)) {
    return { totalHours: 0, totalCost: 0, totalPaid: 0, remaining: 0 };
  }
  const machineObjId = new mongoose.Types.ObjectId(machineId);
  const [entryAgg, paymentSum] = await Promise.all([
    MachineLedgerEntry.aggregate<{ totalHours: number; totalCost: number }>([
      { $match: { machineId: machineObjId } },
      { $group: { _id: null, totalHours: { $sum: "$hoursWorked" }, totalCost: { $sum: "$totalCost" } } },
    ]).then((r) => r[0] ?? { totalHours: 0, totalCost: 0 }),
    MachinePayment.aggregate([{ $match: { machineId: machineObjId } }, { $group: { _id: null, total: { $sum: "$amount" } } }]).then(
      (r) => r[0]?.total ?? 0
    ),
  ]);
  const totalCost = entryAgg.totalCost;
  const totalPaid = paymentSum;
  const remaining = Math.max(0, totalCost - totalPaid);
  return {
    totalHours: entryAgg.totalHours,
    totalCost,
    totalPaid,
    remaining,
  };
}

export interface ListMachinesResult {
  items: MachineWithTotals[];
  total: number;
}

/** One row per machine for a dated running bill (period = inclusive YYYY-MM-DD range). */
export interface MachineRunningBillRow extends MachinePayload {
  currentHours: number;
  previousHours: number;
  totalHours: number;
  thisBill: number;
  previousBill: number;
  totalAmount: number;
  advance: number;
  netAmount: number;
}

/** Column totals for the entire project (all machines), same period rules as rows. */
export interface RunningBillSummary {
  currentHours: number;
  previousHours: number;
  totalHours: number;
  thisBill: number;
  previousBill: number;
  totalAmount: number;
  advance: number;
  netAmount: number;
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
    advance: 0,
    netAmount: 0,
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

  const [globalEntryBuckets, globalAdvance] = await Promise.all([
    MachineLedgerEntry.aggregate<{ _id: string; hours: number; cost: number }>([
      { $match: { projectId: projectObjId } },
      ...bucketStages,
      { $group: { _id: "$bucket", hours: { $sum: "$hoursWorked" }, cost: { $sum: "$totalCost" } } },
    ]),
    (async () => {
      const allIds = await Machine.find({ projectId: projectObjId }).distinct("_id");
      if (allIds.length === 0) return 0;
      const r = await MachinePayment.aggregate<{ t: number }>([
        { $match: { machineId: { $in: allIds }, date: { $lte: periodEnd } } },
        { $group: { _id: null, t: { $sum: "$amount" } } },
      ]);
      return r[0]?.t ?? 0;
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
  const totalAmt = prevC + currC;
  const summary: RunningBillSummary = {
    currentHours: currH,
    previousHours: prevH,
    totalHours: prevH + currH,
    thisBill: currC,
    previousBill: prevC,
    totalAmount: totalAmt,
    advance: globalAdvance,
    netAmount: totalAmt - globalAdvance,
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
    MachinePayment.aggregate<{ _id: mongoose.Types.ObjectId; advance: number }>([
      {
        $match: {
          machineId: { $in: machineObjIds },
          date: { $lte: periodEnd },
        },
      },
      { $group: { _id: "$machineId", advance: { $sum: "$amount" } } },
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

  const payMap = new Map<string, number>();
  for (const p of paymentBuckets) {
    payMap.set(p._id.toString(), p.advance);
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
    const advance = payMap.get(idStr) ?? 0;
    const netAmount = totalAmount - advance;
    return {
      ...toPayload(doc),
      currentHours,
      previousHours,
      totalHours,
      thisBill,
      previousBill,
      totalAmount,
      advance,
      netAmount,
    };
  });

  return { items, total, periodStart, periodEnd, summary };
}

/** List machines for a project with server-side pagination. Site Manager: uses assigned project. */
export async function listMachines(
  actor: { userId: string; role: string },
  params: { projectId?: string; page?: number; pageSize?: number }
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
    const totals = await getMachineTotals(doc._id.toString());
    items.push({
      ...toPayload(doc),
      totalHours: totals.totalHours,
      totalCost: totals.totalCost,
      totalPaid: totals.totalPaid,
      totalPending: totals.remaining,
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
    totalHours: totals.totalHours,
    totalCost: totals.totalCost,
    totalPaid: totals.totalPaid,
    totalPending: totals.remaining,
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
    const user = await User.findById(actor.userId).select("assignedProjectId").lean();
    projectId = user?.assignedProjectId?.toString() ?? "";
    if (!projectId) throw new Error("Site Manager must be assigned to a project to add machines");
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

  await MachinePaymentAllocation.deleteMany({ machineId: id });
  await MachinePayment.deleteMany({ machineId: id });
  await MachineLedgerEntry.deleteMany({ machineId: id });
  await Machine.findByIdAndDelete(id);

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
    description: `Deleted machine: ${target.name}`,
    oldValue: { name: target.name },
  });
}
