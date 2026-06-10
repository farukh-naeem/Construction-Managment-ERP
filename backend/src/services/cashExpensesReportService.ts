import mongoose from "mongoose";
import { Project } from "../models/Project.js";
import { BankAccount } from "../models/BankAccount.js";
import { ItemLedgerEntry } from "../models/ItemLedgerEntry.js";
import { VendorPayment } from "../models/VendorPayment.js";
import { ContractorPayment } from "../models/ContractorPayment.js";
import { EmployeePayment } from "../models/EmployeePayment.js";
import { Expense } from "../models/Expense.js";
import { MachinePayment } from "../models/MachinePayment.js";
import { NonConsumableLedgerEntry } from "../models/NonConsumableLedgerEntry.js";
import { User } from "../models/User.js";
import { BankTransaction } from "../models/BankTransaction.js";
import { ProjectBalanceAdjustment } from "../models/ProjectBalanceAdjustment.js";
import { Vendor } from "../models/Vendor.js";
import { Contractor } from "../models/Contractor.js";
import { Employee } from "../models/Employee.js";
import { Machine } from "../models/Machine.js";
import { ConsumableItem } from "../models/ConsumableItem.js";
import { NonConsumableItem } from "../models/NonConsumableItem.js";

export type CashExpensesEntityType =
  | "Consumable"
  | "NonConsumable"
  | "Vendor"
  | "Contractor"
  | "Salary"
  | "Expense"
  | "Machinery";

export interface CashExpensesReportPayment {
  entityName: string;
  entityType: CashExpensesEntityType;
  /** Amount paid in the selected period (this line). */
  amount: number;
  /** Running balance before this line: all prior days + earlier lines same entity on this day. */
  previousAmount: number;
  /** previousAmount + amount (cumulative after this line). */
  totalAmount: number;
  remarks: string;
  sourceId?: string;
  /** The entity's id (hex for db entities; category string for Expense; "ALL" for Salary). */
  entityId: string;
}

export interface CashExpensesLedgerEntry {
  id: string;
  date: string;
  name: string;
  remarks: string;
  amount: number;
}

export interface CashExpensesEntityLedger {
  entityName: string;
  entityType: CashExpensesEntityType;
  previousAmount: number;
  entries: CashExpensesLedgerEntry[];
  currentTotal: number;
}

export interface CashExpensesReportBankAccount {
  id: string;
  name: string;
  openingBalance: number;
  closingBalance: number;
  inflows: number;
}

export interface CashExpensesReportOpeningBalances {
  projectLedger: number;
  projectLedgerClosing: number;
  projectLedgerInflows: number;
  openingRow: {
    current: number;
    previous: number;
    total: number;
    tPayment: number;
  };
  inflowTransactions: {
    id: string;
    date: string;
    source: string;
    remarks: string;
    current: number;
    previous: number;
    total: number;
    tPayment: number;
  }[];
}

export interface CashExpensesReport {
  openingBalances: CashExpensesReportOpeningBalances;
  payments: CashExpensesReportPayment[];
  totalPayments: number;
  closingBalance: number;
}

async function canAccessProject(
  actor: { userId: string; role: string },
  projectId: string
): Promise<boolean> {
  if (actor.role === "super_admin" || actor.role === "admin") return true;
  if (actor.role === "site_manager") {
    const user = await User.findById(actor.userId).select("assignedProjectId").lean();
    return user?.assignedProjectId?.toString() === projectId;
  }
  return false;
}

function joinRemarks(...parts: (string | undefined | null)[]): string {
  return parts.filter(Boolean).join(" — ") || "";
}

type InternalPayment = {
  entityName: string;
  entityType: CashExpensesEntityType;
  amount: number;
  remarks: string;
  sourceId: string;
  entityKey: string;
};

/** Lean populate may be ObjectId or { _id, name, ... }. */
function populatedIdName(ref: unknown): { id: string; name?: string } {
  if (!ref) return { id: "" };
  if (ref instanceof mongoose.Types.ObjectId) return { id: ref.toString() };
  if (typeof ref === "object" && "_id" in ref) {
    const o = ref as { _id?: mongoose.Types.ObjectId; name?: string };
    return { id: o._id?.toString() ?? "", name: o.name };
  }
  return { id: "" };
}

async function fetchPriorPaymentTotals(
  projectObj: mongoose.Types.ObjectId,
  startDate: string,
  buckets: {
    consumableItemIds: mongoose.Types.ObjectId[];
    vendorIds: mongoose.Types.ObjectId[];
    contractorIds: mongoose.Types.ObjectId[];
    employeeIds: mongoose.Types.ObjectId[];
    expenseCategories: string[];
    machineIds: mongoose.Types.ObjectId[];
    nonConsumableItemIds: mongoose.Types.ObjectId[];
  }
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const {
    consumableItemIds,
    vendorIds,
    contractorIds,
    employeeIds,
    expenseCategories,
    machineIds,
    nonConsumableItemIds,
  } = buckets;

  const vendorsColl = Vendor.collection.name;
  const contractorsColl = Contractor.collection.name;
  const employeesColl = Employee.collection.name;
  const machinesColl = Machine.collection.name;

  const jobs: Promise<void>[] = [];

  if (consumableItemIds.length) {
    jobs.push(
      (async () => {
        const rows = await ItemLedgerEntry.aggregate<{ _id: mongoose.Types.ObjectId; sum: number }>([
          {
            $match: {
              projectId: projectObj,
              itemId: { $in: consumableItemIds },
              date: { $lt: startDate },
              paidAmount: { $gt: 0 },
            },
          },
          { $group: { _id: "$itemId", sum: { $sum: "$paidAmount" } } },
        ]);
        for (const r of rows) {
          out.set(`Consumable:${r._id.toString()}`, r.sum);
        }
      })()
    );
  }

  if (vendorIds.length) {
    jobs.push(
      (async () => {
        const rows = await VendorPayment.aggregate<{ _id: mongoose.Types.ObjectId; sum: number }>([
          { $match: { vendorId: { $in: vendorIds }, date: { $lt: startDate } } },
          { $lookup: { from: vendorsColl, localField: "vendorId", foreignField: "_id", as: "v" } },
          { $unwind: "$v" },
          { $match: { "v.projectId": projectObj } },
          { $group: { _id: "$vendorId", sum: { $sum: "$amount" } } },
        ]);
        for (const r of rows) {
          out.set(`Vendor:${r._id.toString()}`, r.sum);
        }
      })()
    );
  }

  if (contractorIds.length) {
    jobs.push(
      (async () => {
        const rows = await ContractorPayment.aggregate<{ _id: mongoose.Types.ObjectId; sum: number }>([
          { $match: { contractorId: { $in: contractorIds }, date: { $lt: startDate } } },
          { $lookup: { from: contractorsColl, localField: "contractorId", foreignField: "_id", as: "c" } },
          { $unwind: "$c" },
          { $match: { "c.projectId": projectObj } },
          { $group: { _id: "$contractorId", sum: { $sum: "$amount" } } },
        ]);
        for (const r of rows) {
          out.set(`Contractor:${r._id.toString()}`, r.sum);
        }
      })()
    );
  }

  if (employeeIds.length) {
    jobs.push(
      (async () => {
        const allProjectEmployeeIds = await Employee.find({ projectId: projectObj }).distinct("_id");
        const rows = await EmployeePayment.aggregate<{ sum: number }>([
          { $match: { employeeId: { $in: allProjectEmployeeIds }, date: { $lt: startDate } } },
          { $group: { _id: null, sum: { $sum: "$amount" } } },
        ]);
        out.set("Salary:ALL", rows[0]?.sum ?? 0);
      })()
    );
  }

  if (expenseCategories.length) {
    jobs.push(
      (async () => {
        const rows = await Expense.aggregate<{ _id: string; sum: number }>([
          {
            $match: {
              projectId: projectObj,
              date: { $lt: startDate },
              category: { $in: expenseCategories },
            },
          },
          { $group: { _id: "$category", sum: { $sum: "$amount" } } },
        ]);
        for (const r of rows) {
          out.set(`Expense:${r._id}`, r.sum);
        }
      })()
    );
  }

  if (machineIds.length) {
    jobs.push(
      (async () => {
        const rows = await MachinePayment.aggregate<{ _id: mongoose.Types.ObjectId; sum: number }>([
          { $match: { machineId: { $in: machineIds }, date: { $lt: startDate } } },
          { $lookup: { from: machinesColl, localField: "machineId", foreignField: "_id", as: "m" } },
          { $unwind: "$m" },
          { $match: { "m.projectId": projectObj } },
          { $group: { _id: "$machineId", sum: { $sum: "$amount" } } },
        ]);
        for (const r of rows) {
          out.set(`Machinery:${r._id.toString()}`, r.sum);
        }
      })()
    );
  }

  if (nonConsumableItemIds.length) {
    jobs.push(
      (async () => {
        const rows = await NonConsumableLedgerEntry.aggregate<{ _id: mongoose.Types.ObjectId; sum: number }>([
          {
            $match: {
              date: { $lt: startDate },
              eventType: "Purchase",
              totalCost: { $gt: 0 },
              itemId: { $in: nonConsumableItemIds },
              $or: [{ projectTo: projectObj }, { projectFrom: projectObj }],
            },
          },
          { $group: { _id: "$itemId", sum: { $sum: "$totalCost" } } },
        ]);
        for (const r of rows) {
          out.set(`NonConsumable:${r._id.toString()}`, r.sum);
        }
      })()
    );
  }

  await Promise.all(jobs);
  return out;
}

/** Aggregate many payments into one InternalPayment per entity. Remarks are dropped. */
function pushAggregatedByEntity(
  internal: InternalPayment[],
  entries: { id: string; name?: string; amount: number }[],
  entityType: CashExpensesEntityType,
  fallbackName: string
) {
  const byEntity = new Map<string, { name: string; total: number }>();
  for (const e of entries) {
    if (!e.id) continue;
    const cur = byEntity.get(e.id);
    if (cur) cur.total += e.amount;
    else byEntity.set(e.id, { name: e.name ?? fallbackName, total: e.amount });
  }
  for (const [id, { name, total }] of byEntity) {
    internal.push({
      entityName: name,
      entityType,
      amount: total,
      remarks: "",
      sourceId: `${entityType}-${id}`,
      entityKey: `${entityType}:${id}`,
    });
  }
}

function applyRunningPreviousAndTotal(
  rows: InternalPayment[],
  priorTotals: Map<string, number>
): CashExpensesReportPayment[] {
  const sorted = [...rows].sort((a, b) => {
    const k = a.entityKey.localeCompare(b.entityKey);
    if (k !== 0) return k;
    return a.sourceId.localeCompare(b.sourceId);
  });
  const sameDayRunning = new Map<string, number>();
  const result: CashExpensesReportPayment[] = [];
  for (const row of sorted) {
    const prior = priorTotals.get(row.entityKey) ?? 0;
    const earlierToday = sameDayRunning.get(row.entityKey) ?? 0;
    const previousAmount = prior + earlierToday;
    const totalAmount = previousAmount + row.amount;
    sameDayRunning.set(row.entityKey, earlierToday + row.amount);
    result.push({
      entityName: row.entityName,
      entityType: row.entityType,
      amount: row.amount,
      previousAmount,
      totalAmount,
      remarks: row.remarks,
      sourceId: row.sourceId,
      entityId: row.entityKey.slice(row.entityKey.indexOf(":") + 1),
    });
  }
  return result;
}

async function fetchProjectAllTimeInflowsToDate(
  projectObj: mongoose.Types.ObjectId,
  toDate: string
): Promise<number> {
  const [bankInflowsToProject, projectLedgerAdjustments] = await Promise.all([
    BankTransaction.aggregate<{ sum: number }>([
      {
        $match: {
          projectId: projectObj,
          type: "outflow",
          date: { $lte: toDate },
        },
      },
      { $group: { _id: null, sum: { $sum: "$amount" } } },
    ]),
    ProjectBalanceAdjustment.aggregate<{ sum: number }>([
      {
        $match: {
          projectId: projectObj,
          date: { $lte: toDate },
          amount: { $gt: 0 },
        },
      },
      { $group: { _id: null, sum: { $sum: "$amount" } } },
    ]),
  ]);

  return (bankInflowsToProject[0]?.sum ?? 0) + (projectLedgerAdjustments[0]?.sum ?? 0);
}

async function fetchProjectInflowsBeforeDate(
  projectObj: mongoose.Types.ObjectId,
  startDate: string
): Promise<number> {
  const [bankInflowsToProject, projectLedgerAdjustments] = await Promise.all([
    BankTransaction.aggregate<{ sum: number }>([
      {
        $match: {
          projectId: projectObj,
          type: "outflow",
          date: { $lt: startDate },
        },
      },
      { $group: { _id: null, sum: { $sum: "$amount" } } },
    ]),
    ProjectBalanceAdjustment.aggregate<{ sum: number }>([
      {
        $match: {
          projectId: projectObj,
          date: { $lt: startDate },
          amount: { $gt: 0 },
        },
      },
      { $group: { _id: null, sum: { $sum: "$amount" } } },
    ]),
  ]);

  return (bankInflowsToProject[0]?.sum ?? 0) + (projectLedgerAdjustments[0]?.sum ?? 0);
}

export async function getCashExpensesReport(
  actor: { userId: string; role: string },
  projectId: string,
  startDate: string,
  endDate: string
): Promise<CashExpensesReport> {
  if (!mongoose.Types.ObjectId.isValid(projectId)) {
    throw new Error("Invalid project ID");
  }
  const projectObj = new mongoose.Types.ObjectId(projectId);

  const project = await Project.findById(projectId).lean();
  if (!project) {
    throw new Error("Project not found");
  }

  const allowed = await canAccessProject(actor, projectId);
  if (!allowed) {
    throw new Error("Project not found or access denied");
  }

  const inRange = { $gte: startDate, $lte: endDate } as const;

  const todayIso = new Date().toISOString().slice(0, 10);

  const [
    bankAccounts,
    bankOutflowsToProjectTxs,
    projectAdjustmentsInflowsRows,
    consumablePayments,
    vendorPayments,
    contractorPayments,
    employeePayments,
    expenses,
    machinePayments,
    nonConsumablePayments,
    allTimeProjectInflows,
    inflowsBeforeStartDate,
  ] = await Promise.all([
    BankAccount.find({}).select("_id name").lean(),
    BankTransaction.find({ projectId: projectObj, type: "outflow", date: inRange }).lean(),
    ProjectBalanceAdjustment.find({ projectId: projectObj, date: inRange }).lean(),
    ItemLedgerEntry.find({ projectId: projectObj, date: inRange, paidAmount: { $gt: 0 } })
      .populate<{ itemId: { name: string } }>("itemId", "name")
      .lean(),
    VendorPayment.find({ date: inRange })
      .populate<{ vendorId: { projectId: mongoose.Types.ObjectId; name: string } }>("vendorId", "projectId name")
      .lean()
      .then((rows) => rows.filter((r) => r.vendorId?.projectId?.toString() === projectId)),
    ContractorPayment.find({ date: inRange })
      .populate<{ contractorId: { projectId: mongoose.Types.ObjectId; name: string } }>("contractorId", "projectId name")
      .lean()
      .then((rows) => rows.filter((r) => r.contractorId?.projectId?.toString() === projectId)),
    EmployeePayment.find({ date: inRange })
      .populate<{ employeeId: { projectId: mongoose.Types.ObjectId; name: string } }>("employeeId", "projectId name")
      .lean()
      .then((rows) => rows.filter((r) => r.employeeId?.projectId?.toString() === projectId)),
    Expense.find({ projectId: projectObj, date: inRange }).lean(),
    MachinePayment.find({ date: inRange })
      .populate<{ machineId: { projectId: mongoose.Types.ObjectId; name: string } }>("machineId", "projectId name")
      .lean()
      .then((rows) => rows.filter((r) => r.machineId?.projectId?.toString() === projectId)),
    NonConsumableLedgerEntry.find({
      date: inRange,
      eventType: "Purchase",
      totalCost: { $gt: 0 },
      $or: [{ projectTo: projectObj }, { projectFrom: projectObj }],
    })
      .populate<{ itemId: { name: string } }>("itemId", "name")
      .lean(),
    fetchProjectAllTimeInflowsToDate(projectObj, todayIso),
    fetchProjectInflowsBeforeDate(projectObj, startDate),
  ]);

  const internal: InternalPayment[] = [];

  pushAggregatedByEntity(
    internal,
    consumablePayments.map((row) => ({ ...populatedIdName(row.itemId), amount: row.paidAmount })),
    "Consumable",
    "Consumable"
  );

  pushAggregatedByEntity(
    internal,
    vendorPayments.map((row) => ({ ...populatedIdName(row.vendorId), amount: row.amount })),
    "Vendor",
    "Vendor"
  );

  pushAggregatedByEntity(
    internal,
    contractorPayments.map((row) => ({ ...populatedIdName(row.contractorId), amount: row.amount })),
    "Contractor",
    "Contractor"
  );

  if (employeePayments.length > 0) {
    const totalEmployeeAmount = employeePayments.reduce((s, r) => s + r.amount, 0);
    internal.push({
      entityName: "Employees",
      entityType: "Salary",
      amount: totalEmployeeAmount,
      remarks: "",
      sourceId: "salary-all",
      entityKey: "Salary:ALL",
    });
  }

  const expenseByCat = new Map<string, { name: string; total: number }>();
  for (const row of expenses) {
    const cat = row.category.trim();
    const e = expenseByCat.get(cat);
    if (e) e.total += row.amount;
    else expenseByCat.set(cat, { name: row.category || row.description, total: row.amount });
  }
  for (const [cat, { name, total }] of expenseByCat) {
    internal.push({
      entityName: name,
      entityType: "Expense",
      amount: total,
      remarks: "",
      sourceId: `expense-cat-${cat}`,
      entityKey: `Expense:${cat}`,
    });
  }

  pushAggregatedByEntity(
    internal,
    machinePayments.map((row) => ({ ...populatedIdName(row.machineId), amount: row.amount })),
    "Machinery",
    "Machinery"
  );

  pushAggregatedByEntity(
    internal,
    nonConsumablePayments
      .filter((row) => (row.totalCost ?? 0) > 0)
      .map((row) => ({ ...populatedIdName(row.itemId), amount: row.totalCost ?? 0 })),
    "NonConsumable",
    "Non-Consumable"
  );

  const uniqStrings = (xs: string[]) => [...new Set(xs)];
  const uniqObjectIds = (hexIds: string[]) => {
    const seen = new Set<string>();
    const out: mongoose.Types.ObjectId[] = [];
    for (const h of hexIds) {
      if (!h || seen.has(h)) continue;
      seen.add(h);
      out.push(new mongoose.Types.ObjectId(h));
    }
    return out;
  };

  const priorTotals =
    internal.length === 0
      ? new Map<string, number>()
      : await fetchPriorPaymentTotals(projectObj, startDate, {
          consumableItemIds: uniqObjectIds(
            internal.filter((r) => r.entityType === "Consumable").map((r) => r.entityKey.split(":")[1])
          ),
          vendorIds: uniqObjectIds(
            internal.filter((r) => r.entityType === "Vendor").map((r) => r.entityKey.split(":")[1])
          ),
          contractorIds: uniqObjectIds(
            internal.filter((r) => r.entityType === "Contractor").map((r) => r.entityKey.split(":")[1])
          ),
          employeeIds: internal.some((r) => r.entityType === "Salary") ? [projectObj] : [],
          expenseCategories: uniqStrings(
            internal.filter((r) => r.entityType === "Expense").map((r) => r.entityKey.slice("Expense:".length))
          ),
          machineIds: uniqObjectIds(
            internal.filter((r) => r.entityType === "Machinery").map((r) => r.entityKey.split(":")[1])
          ),
          nonConsumableItemIds: uniqObjectIds(
            internal.filter((r) => r.entityType === "NonConsumable").map((r) => r.entityKey.split(":")[1])
          ),
        });

  const payments = applyRunningPreviousAndTotal(internal, priorTotals);

  const totalPayments = payments.reduce((s, p) => s + p.amount, 0);
  const projectLedgerClosing = project.balance ?? 0;
  const bankNameById: Record<string, string> = {};
  for (const acc of bankAccounts) {
    bankNameById[acc._id.toString()] = acc.name;
  }
  const bankOutflowsToProjectRange = bankOutflowsToProjectTxs.reduce((s, t) => s + t.amount, 0);
  const projectAdjustmentsInflowsRange = projectAdjustmentsInflowsRows
    .filter((r) => r.amount > 0)
    .reduce((s, r) => s + r.amount, 0);
  const projectLedgerInflows = bankOutflowsToProjectRange + projectAdjustmentsInflowsRange;
  const inflowTransactions = [
    ...bankOutflowsToProjectTxs.map((tx) => {
      const accountId = tx.accountId.toString();
      const current = tx.amount;
      const previous = 0;
      const total = current + previous;
      return {
        id: `bank-${tx._id.toString()}`,
        date: tx.date,
        source: bankNameById[accountId] ?? "Bank Account",
        remarks: joinRemarks(tx.referenceId, tx.remarks),
        current,
        previous,
        total,
        tPayment: total,
      };
    }),
    ...projectAdjustmentsInflowsRows
      .filter((r) => r.amount > 0)
      .map((r) => {
        const current = r.amount;
        const previous = 0;
        const total = current + previous;
        return {
          id: `adj-${r._id.toString()}`,
          date: r.date,
          source: "",
          remarks: r.remarks?.trim() ?? "",
          current,
          previous,
          total,
          tPayment: total,
        };
      }),
  ].sort((a, b) => {
    const d = a.date.localeCompare(b.date);
    if (d !== 0) return d;
    return a.id.localeCompare(b.id);
  });
  // Project: opening + inflows in selected period - total payments in selected period = closing
  const projectLedgerOpening = projectLedgerClosing - projectLedgerInflows + totalPayments;

  const openingRowCurrent = 0;
  const openingRowPrevious = inflowsBeforeStartDate;
  const openingRowTotal = openingRowPrevious;
  const openingRowTPayment = allTimeProjectInflows;

  const closingBalance = projectLedgerClosing;

  const openingBalances: CashExpensesReportOpeningBalances = {
    projectLedger: projectLedgerOpening,
    projectLedgerClosing,
    projectLedgerInflows,
    openingRow: {
      current: openingRowCurrent,
      previous: openingRowPrevious,
      total: openingRowTotal,
      tPayment: openingRowTPayment,
    },
    inflowTransactions,
  };

  return {
    openingBalances,
    payments,
    totalPayments,
    closingBalance,
  };
}

export async function getCashExpensesEntityLedger(
  actor: { userId: string; role: string },
  projectId: string,
  entityType: CashExpensesEntityType,
  entityId: string,
  startDate: string,
  endDate: string
): Promise<CashExpensesEntityLedger> {
  if (!mongoose.Types.ObjectId.isValid(projectId)) throw new Error("Invalid project ID");
  const projectObj = new mongoose.Types.ObjectId(projectId);

  const allowed = await canAccessProject(actor, projectId);
  if (!allowed) throw new Error("Project not found or access denied");

  const inRange = { $gte: startDate, $lte: endDate } as const;

  const vendorsColl = Vendor.collection.name;
  const contractorsColl = Contractor.collection.name;
  const machinesColl = Machine.collection.name;

  if (entityType === "Consumable") {
    if (!mongoose.Types.ObjectId.isValid(entityId)) throw new Error("Invalid entity ID");
    const itemObj = new mongoose.Types.ObjectId(entityId);
    const [item, docs, prevAgg] = await Promise.all([
      ConsumableItem.findById(itemObj).select("name").lean(),
      ItemLedgerEntry.find({ projectId: projectObj, itemId: itemObj, date: inRange, paidAmount: { $gt: 0 } })
        .sort({ date: 1, createdAt: 1 })
        .lean(),
      ItemLedgerEntry.aggregate<{ sum: number }>([
        { $match: { projectId: projectObj, itemId: itemObj, date: { $lt: startDate }, paidAmount: { $gt: 0 } } },
        { $group: { _id: null, sum: { $sum: "$paidAmount" } } },
      ]),
    ]);
    const entries: CashExpensesLedgerEntry[] = docs.map((d) => ({
      id: d._id.toString(),
      date: d.date,
      name: "",
      remarks: joinRemarks(d.referenceId, d.remarks),
      amount: d.paidAmount,
    }));
    return {
      entityName: item?.name ?? "Consumable",
      entityType,
      previousAmount: prevAgg[0]?.sum ?? 0,
      entries,
      currentTotal: entries.reduce((s, e) => s + e.amount, 0),
    };
  }

  if (entityType === "Vendor") {
    if (!mongoose.Types.ObjectId.isValid(entityId)) throw new Error("Invalid entity ID");
    const vendorObj = new mongoose.Types.ObjectId(entityId);
    const [vendor, docs, prevAgg] = await Promise.all([
      Vendor.findById(vendorObj).select("name").lean(),
      VendorPayment.find({ vendorId: vendorObj, date: inRange }).sort({ date: 1, createdAt: 1 }).lean().then((rows) =>
        rows.filter((r) => {
          const vid = (r as unknown as { vendorId: { projectId?: mongoose.Types.ObjectId } }).vendorId;
          return true; // already filtered by vendorId which belongs to a project
        })
      ),
      VendorPayment.aggregate<{ sum: number }>([
        { $match: { vendorId: vendorObj, date: { $lt: startDate } } },
        { $lookup: { from: vendorsColl, localField: "vendorId", foreignField: "_id", as: "v" } },
        { $unwind: "$v" },
        { $match: { "v.projectId": projectObj } },
        { $group: { _id: null, sum: { $sum: "$amount" } } },
      ]),
    ]);
    const entries: CashExpensesLedgerEntry[] = docs.map((d) => ({
      id: d._id.toString(),
      date: d.date,
      name: "",
      remarks: joinRemarks(d.referenceId, d.remarks),
      amount: d.amount,
    }));
    return {
      entityName: vendor?.name ?? "Vendor",
      entityType,
      previousAmount: prevAgg[0]?.sum ?? 0,
      entries,
      currentTotal: entries.reduce((s, e) => s + e.amount, 0),
    };
  }

  if (entityType === "Contractor") {
    if (!mongoose.Types.ObjectId.isValid(entityId)) throw new Error("Invalid entity ID");
    const contractorObj = new mongoose.Types.ObjectId(entityId);
    const [contractor, docs, prevAgg] = await Promise.all([
      Contractor.findById(contractorObj).select("name").lean(),
      ContractorPayment.find({ contractorId: contractorObj, date: inRange }).sort({ date: 1, createdAt: 1 }).lean(),
      ContractorPayment.aggregate<{ sum: number }>([
        { $match: { contractorId: contractorObj, date: { $lt: startDate } } },
        { $lookup: { from: contractorsColl, localField: "contractorId", foreignField: "_id", as: "c" } },
        { $unwind: "$c" },
        { $match: { "c.projectId": projectObj } },
        { $group: { _id: null, sum: { $sum: "$amount" } } },
      ]),
    ]);
    const entries: CashExpensesLedgerEntry[] = docs.map((d) => ({
      id: d._id.toString(),
      date: d.date,
      name: "",
      remarks: joinRemarks((d as unknown as { referenceId?: string }).referenceId),
      amount: d.amount,
    }));
    return {
      entityName: contractor?.name ?? "Contractor",
      entityType,
      previousAmount: prevAgg[0]?.sum ?? 0,
      entries,
      currentTotal: entries.reduce((s, e) => s + e.amount, 0),
    };
  }

  if (entityType === "Machinery") {
    if (!mongoose.Types.ObjectId.isValid(entityId)) throw new Error("Invalid entity ID");
    const machineObj = new mongoose.Types.ObjectId(entityId);
    const [machine, docs, prevAgg] = await Promise.all([
      Machine.findById(machineObj).select("name").lean(),
      MachinePayment.find({ machineId: machineObj, date: inRange }).sort({ date: 1, createdAt: 1 }).lean(),
      MachinePayment.aggregate<{ sum: number }>([
        { $match: { machineId: machineObj, date: { $lt: startDate } } },
        { $lookup: { from: machinesColl, localField: "machineId", foreignField: "_id", as: "m" } },
        { $unwind: "$m" },
        { $match: { "m.projectId": projectObj } },
        { $group: { _id: null, sum: { $sum: "$amount" } } },
      ]),
    ]);
    const entries: CashExpensesLedgerEntry[] = docs.map((d) => ({
      id: d._id.toString(),
      date: d.date,
      name: "",
      remarks: joinRemarks(d.referenceId),
      amount: d.amount,
    }));
    return {
      entityName: machine?.name ?? "Machinery",
      entityType,
      previousAmount: prevAgg[0]?.sum ?? 0,
      entries,
      currentTotal: entries.reduce((s, e) => s + e.amount, 0),
    };
  }

  if (entityType === "NonConsumable") {
    if (!mongoose.Types.ObjectId.isValid(entityId)) throw new Error("Invalid entity ID");
    const ncItemObj = new mongoose.Types.ObjectId(entityId);
    const [ncItem, docs, prevAgg] = await Promise.all([
      NonConsumableItem.findById(ncItemObj).select("name").lean(),
      NonConsumableLedgerEntry.find({
        itemId: ncItemObj,
        date: inRange,
        eventType: "Purchase",
        totalCost: { $gt: 0 },
        $or: [{ projectTo: projectObj }, { projectFrom: projectObj }],
      }).sort({ date: 1, createdAt: 1 }).lean(),
      NonConsumableLedgerEntry.aggregate<{ sum: number }>([
        {
          $match: {
            itemId: ncItemObj,
            date: { $lt: startDate },
            eventType: "Purchase",
            totalCost: { $gt: 0 },
            $or: [{ projectTo: projectObj }, { projectFrom: projectObj }],
          },
        },
        { $group: { _id: null, sum: { $sum: "$totalCost" } } },
      ]),
    ]);
    const entries: CashExpensesLedgerEntry[] = docs.map((d) => ({
      id: d._id.toString(),
      date: d.date,
      name: "",
      remarks: d.remarks ?? "",
      amount: d.totalCost ?? 0,
    }));
    return {
      entityName: ncItem?.name ?? "Non-Consumable",
      entityType,
      previousAmount: prevAgg[0]?.sum ?? 0,
      entries,
      currentTotal: entries.reduce((s, e) => s + e.amount, 0),
    };
  }

  if (entityType === "Expense") {
    const category = entityId;
    const [docs, prevAgg] = await Promise.all([
      Expense.find({ projectId: projectObj, category, date: inRange }).sort({ date: 1, createdAt: 1 }).lean(),
      Expense.aggregate<{ sum: number }>([
        { $match: { projectId: projectObj, category, date: { $lt: startDate } } },
        { $group: { _id: null, sum: { $sum: "$amount" } } },
      ]),
    ]);
    const entries: CashExpensesLedgerEntry[] = docs.map((d) => ({
      id: d._id.toString(),
      date: d.date,
      name: "",
      remarks: d.description,
      amount: d.amount,
    }));
    return {
      entityName: category,
      entityType,
      previousAmount: prevAgg[0]?.sum ?? 0,
      entries,
      currentTotal: entries.reduce((s, e) => s + e.amount, 0),
    };
  }

  if (entityType === "Salary") {
    const allProjectEmployeeIds = await Employee.find({ projectId: projectObj }).distinct("_id");
    const [docs, prevAgg] = await Promise.all([
      EmployeePayment.find({ employeeId: { $in: allProjectEmployeeIds }, date: inRange })
        .populate<{ employeeId: { name: string } }>("employeeId", "name")
        .sort({ date: 1, createdAt: 1 })
        .lean(),
      EmployeePayment.aggregate<{ sum: number }>([
        { $match: { employeeId: { $in: allProjectEmployeeIds }, date: { $lt: startDate } } },
        { $group: { _id: null, sum: { $sum: "$amount" } } },
      ]),
    ]);
    const entries: CashExpensesLedgerEntry[] = docs.map((d) => {
      const emp = populatedIdName(d.employeeId);
      return {
        id: d._id.toString(),
        date: d.date,
        name: emp.name ?? "Employee",
        remarks: (d as unknown as { remarks?: string }).remarks ?? "",
        amount: d.amount,
      };
    });
    return {
      entityName: "Employees",
      entityType,
      previousAmount: prevAgg[0]?.sum ?? 0,
      entries,
      currentTotal: entries.reduce((s, e) => s + e.amount, 0),
    };
  }

  throw new Error(`Unsupported entity type: ${entityType}`);
}
