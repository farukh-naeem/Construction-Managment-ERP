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
        const rows = await EmployeePayment.aggregate<{ _id: mongoose.Types.ObjectId; sum: number }>([
          { $match: { employeeId: { $in: employeeIds }, date: { $lt: startDate } } },
          { $lookup: { from: employeesColl, localField: "employeeId", foreignField: "_id", as: "e" } },
          { $unwind: "$e" },
          { $match: { "e.projectId": projectObj } },
          { $group: { _id: "$employeeId", sum: { $sum: "$amount" } } },
        ]);
        for (const r of rows) {
          out.set(`Salary:${r._id.toString()}`, r.sum);
        }
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

  for (const row of consumablePayments) {
    const { id: itemId, name: itemName } = populatedIdName(row.itemId);
    if (!itemId) continue;
    internal.push({
      entityName: itemName ?? "Consumable",
      entityType: "Consumable",
      amount: row.paidAmount,
      remarks: joinRemarks(row.referenceId, row.remarks),
      sourceId: row._id.toString(),
      entityKey: `Consumable:${itemId}`,
    });
  }

  for (const row of vendorPayments) {
    const { id: vid, name: vName } = populatedIdName(row.vendorId);
    if (!vid) continue;
    internal.push({
      entityName: vName ?? "Vendor",
      entityType: "Vendor",
      amount: row.amount,
      remarks: joinRemarks(row.referenceId, row.remarks),
      sourceId: row._id.toString(),
      entityKey: `Vendor:${vid}`,
    });
  }

  for (const row of contractorPayments) {
    const { id: cid, name: cName } = populatedIdName(row.contractorId);
    if (!cid) continue;
    internal.push({
      entityName: cName ?? "Contractor",
      entityType: "Contractor",
      amount: row.amount,
      remarks: joinRemarks((row as { referenceId?: string }).referenceId),
      sourceId: row._id.toString(),
      entityKey: `Contractor:${cid}`,
    });
  }

  for (const row of employeePayments) {
    const { id: eid, name: eName } = populatedIdName(row.employeeId);
    if (!eid) continue;
    internal.push({
      entityName: eName ?? "Employee",
      entityType: "Salary",
      amount: row.amount,
      remarks: joinRemarks(row.remarks),
      sourceId: row._id.toString(),
      entityKey: `Salary:${eid}`,
    });
  }

  for (const row of expenses) {
    const cat = row.category.trim();
    internal.push({
      entityName: row.category || row.description,
      entityType: "Expense",
      amount: row.amount,
      remarks: row.description || "",
      sourceId: row._id.toString(),
      entityKey: `Expense:${cat}`,
    });
  }

  for (const row of machinePayments) {
    const { id: mid, name: mName } = populatedIdName(row.machineId);
    if (!mid) continue;
    internal.push({
      entityName: mName ?? "Machinery",
      entityType: "Machinery",
      amount: row.amount,
      remarks: joinRemarks(row.referenceId),
      sourceId: row._id.toString(),
      entityKey: `Machinery:${mid}`,
    });
  }

  for (const row of nonConsumablePayments) {
    const cost = row.totalCost ?? 0;
    if (cost <= 0) continue;
    const { id: nid, name: nName } = populatedIdName(row.itemId);
    if (!nid) continue;
    internal.push({
      entityName: nName ?? "Non-Consumable",
      entityType: "NonConsumable",
      amount: cost,
      remarks: joinRemarks(row.remarks),
      sourceId: row._id.toString(),
      entityKey: `NonConsumable:${nid}`,
    });
  }

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
          employeeIds: uniqObjectIds(
            internal.filter((r) => r.entityType === "Salary").map((r) => r.entityKey.split(":")[1])
          ),
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
