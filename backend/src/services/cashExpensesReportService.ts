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
  /** Amount paid on the report date (this line). */
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
  bankAccounts: CashExpensesReportBankAccount[];
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
  date: string,
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
              date: { $lt: date },
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
          { $match: { vendorId: { $in: vendorIds }, date: { $lt: date } } },
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
          { $match: { contractorId: { $in: contractorIds }, date: { $lt: date } } },
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
          { $match: { employeeId: { $in: employeeIds }, date: { $lt: date } } },
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
              date: { $lt: date },
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
          { $match: { machineId: { $in: machineIds }, date: { $lt: date } } },
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
              date: { $lt: date },
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

export async function getCashExpensesReport(
  actor: { userId: string; role: string },
  projectId: string,
  date: string
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

  const [bankAccounts, bankTxByAccount, bankOutflowsToProjectToday, projectAdjustmentsInflowsToday, consumablePayments, vendorPayments, contractorPayments, employeePayments, expenses, machinePayments, nonConsumablePayments] = await Promise.all([
    BankAccount.find({}).select("_id name currentBalance").lean(),
    BankTransaction.find({ date }).lean().then((txs) => {
      const byAccount: Record<string, { inflow: number; outflow: number }> = {};
      for (const t of txs) {
        const id = t.accountId.toString();
        if (!byAccount[id]) byAccount[id] = { inflow: 0, outflow: 0 };
        if (t.type === "inflow") byAccount[id].inflow += t.amount;
        else byAccount[id].outflow += t.amount;
      }
      return byAccount;
    }),
    BankTransaction.find({ projectId: projectObj, type: "outflow", date })
      .lean()
      .then((txs) => txs.reduce((s, t) => s + t.amount, 0)),
    ProjectBalanceAdjustment.find({ projectId: projectObj, date })
      .lean()
      .then((rows) => rows.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0)),
    ItemLedgerEntry.find({ projectId: projectObj, date, paidAmount: { $gt: 0 } })
      .populate<{ itemId: { name: string } }>("itemId", "name")
      .lean(),
    VendorPayment.find({ date })
      .populate<{ vendorId: { projectId: mongoose.Types.ObjectId; name: string } }>("vendorId", "projectId name")
      .lean()
      .then((rows) => rows.filter((r) => r.vendorId?.projectId?.toString() === projectId)),
    ContractorPayment.find({ date })
      .populate<{ contractorId: { projectId: mongoose.Types.ObjectId; name: string } }>("contractorId", "projectId name")
      .lean()
      .then((rows) => rows.filter((r) => r.contractorId?.projectId?.toString() === projectId)),
    EmployeePayment.find({ date })
      .populate<{ employeeId: { projectId: mongoose.Types.ObjectId; name: string } }>("employeeId", "projectId name")
      .lean()
      .then((rows) => rows.filter((r) => r.employeeId?.projectId?.toString() === projectId)),
    Expense.find({ projectId: projectObj, date }).lean(),
    MachinePayment.find({ date })
      .populate<{ machineId: { projectId: mongoose.Types.ObjectId; name: string } }>("machineId", "projectId name")
      .lean()
      .then((rows) => rows.filter((r) => r.machineId?.projectId?.toString() === projectId)),
    NonConsumableLedgerEntry.find({
      date,
      eventType: "Purchase",
      totalCost: { $gt: 0 },
      $or: [{ projectTo: projectObj }, { projectFrom: projectObj }],
    })
      .populate<{ itemId: { name: string } }>("itemId", "name")
      .lean(),
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
      : await fetchPriorPaymentTotals(projectObj, date, {
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
  const projectLedgerInflows = bankOutflowsToProjectToday + projectAdjustmentsInflowsToday;
  // Project: opening + total inflows to project - total payments = closing (project.balance)
  const projectInflowsToday = projectLedgerInflows;
  const projectLedgerOpening = projectLedgerClosing - projectInflowsToday + totalPayments;
  // Bank: opening = start-of-day balance; closing = current; inflows = sum of inflows to that bank on the day
  const bankAccountsWithClosing = bankAccounts.map((acc) => {
    const id = acc._id.toString();
    const current = acc.currentBalance ?? 0;
    const day = bankTxByAccount[id] ?? { inflow: 0, outflow: 0 };
    const opening = current - day.inflow + day.outflow;
    return {
      id,
      name: acc.name,
      openingBalance: opening,
      closingBalance: current,
      inflows: day.inflow,
    };
  });
  const bankOpeningTotal = bankAccountsWithClosing.reduce((s, a) => s + a.openingBalance, 0);
  const bankClosingTotal = bankAccountsWithClosing.reduce((s, a) => s + a.closingBalance, 0);
  const totalOpening = projectLedgerOpening + bankOpeningTotal;
  const closingBalance = projectLedgerClosing + bankClosingTotal;

  const openingBalances: CashExpensesReportOpeningBalances = {
    projectLedger: projectLedgerOpening,
    projectLedgerClosing,
    projectLedgerInflows,
    bankAccounts: bankAccountsWithClosing,
  };

  return {
    openingBalances,
    payments,
    totalPayments,
    closingBalance,
  };
}
