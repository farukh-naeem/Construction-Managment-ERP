import mongoose from "mongoose";
import { Employee } from "../models/Employee.js";
import { Machine } from "../models/Machine.js";
import { EmployeePayment } from "../models/EmployeePayment.js";
import { Project } from "../models/Project.js";
import { User } from "../models/User.js";
import { logAudit, getProjectName } from "./auditService.js";
import { roleDisplay } from "./authService.js";
import { resolveSiteManagerProjectId, getAssignedProjectIds } from "./projectAccessService.js";
import { getEmployeeTotals, getEmployeeSnapshotForMonth } from "./employeeLedgerService.js";
import type { MonthlySnapshot } from "./employeeLedgerService.js";
import type { EmployeeCategory, EmployeeType } from "../models/Employee.js";

export interface EmployeePayload {
  id: string;
  projectId: string;
  project?: string;
  name: string;
  role: string;
  type: EmployeeType;
  monthlySalary?: number;
  dailyRate?: number;
  phone: string;
  category: EmployeeCategory;
  machineId?: string;
  totalPaid?: number;
  totalDue?: number;
  /** Advance handed over beyond everything earned so far — the receivable mirror of totalDue. */
  totalAdvance?: number;
  createdAt?: string;
  /** User-specified "YYYY-MM-DD" date the employee actually joined; overrides createdAt as the No-Data cutoff. */
  joiningDate?: string;
  /** User-specified "YYYY-MM-DD" date the employee actually left. When set, no salary/wage accrues
   *  after this month (the ending month is prorated up to this day) and it's excluded from liabilities. */
  endingDate?: string;
}

export interface CreateEmployeeInput {
  projectId: string;
  name: string;
  role: string;
  type: EmployeeType;
  monthlySalary?: number;
  dailyRate?: number;
  phone?: string;
  joiningDate?: string;
  endingDate?: string;
  category?: EmployeeCategory;
  machineId?: string;
}

export interface UpdateEmployeeInput {
  name?: string;
  role?: string;
  type?: EmployeeType;
  monthlySalary?: number;
  dailyRate?: number;
  phone?: string;
  joiningDate?: string;
  endingDate?: string;
  machineId?: string;
}

function toPayload(
  doc: {
    _id: mongoose.Types.ObjectId;
    projectId: mongoose.Types.ObjectId;
    name: string;
    role: string;
    type: EmployeeType;
    monthlySalary?: number;
    dailyRate?: number;
    phone?: string;
    category?: EmployeeCategory;
    machineId?: mongoose.Types.ObjectId;
    createdAt?: Date;
    joiningDate?: string;
    endingDate?: string;
  },
  projectName?: string,
  totals?: { totalPaid: number; totalDue: number; totalAdvance?: number }
): EmployeePayload {
  return {
    id: doc._id.toString(),
    projectId: doc.projectId.toString(),
    project: projectName,
    name: doc.name,
    role: doc.role,
    type: doc.type,
    monthlySalary: doc.monthlySalary,
    dailyRate: doc.dailyRate,
    phone: doc.phone ?? "",
    category: doc.category ?? "Regular",
    machineId: doc.machineId?.toString(),
    totalPaid: totals?.totalPaid,
    totalDue: totals?.totalDue,
    totalAdvance: totals?.totalAdvance,
    createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : undefined,
    joiningDate: doc.joiningDate,
    endingDate: doc.endingDate,
  };
}

/** Validates a "YYYY-MM-DD" date string; throws (with the given field label) if malformed. */
function validateDateString(value: string, label: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(new Date(value).getTime())) {
    throw new Error(`${label} must be a valid date (YYYY-MM-DD)`);
  }
  return value;
}

function validateJoiningDate(value: string): string {
  return validateDateString(value, "Joining date");
}

function validateEndingDate(value: string): string {
  return validateDateString(value, "Ending date");
}

export interface EmployeeListOptions {
  month?: string;
  category?: EmployeeCategory;
  /** Inclusive "YYYY-MM-DD" range. When provided, totalPaid/totalDue are computed within that
   *  period instead of all-time — see getEmployeeTotals for date-range semantics. */
  startDate?: string;
  endDate?: string;
}

/** List employees for a project. When month is provided, includes snapshot (payable, paid, remaining, paymentStatus) for that month. */
export async function listEmployees(
  actor: { userId: string; role: string },
  projectIdParam?: string,
  options?: EmployeeListOptions
): Promise<(EmployeePayload & { snapshot?: MonthlySnapshot })[]> {
  let projectId: string | undefined;
  if (actor.role === "site_manager") {
    projectId = await resolveSiteManagerProjectId(actor.userId, projectIdParam);
    if (!projectId) return [];
  } else {
    projectId = projectIdParam;
  }
  const query: Record<string, unknown> = projectId && mongoose.Types.ObjectId.isValid(projectId) ? { projectId: new mongoose.Types.ObjectId(projectId) } : {};
  query.category = options?.category === "Machinery"
    ? "Machinery"
    : { $in: ["Regular", null] }; // retain existing employees created before the category field
  const docs = await Employee.find(query)
    .select("_id projectId name role type monthlySalary dailyRate phone category machineId createdAt joiningDate endingDate")
    .lean();
  const projectIds = [...new Set(docs.map((d) => d.projectId.toString()))];
  const projects = await Project.find({ _id: { $in: projectIds } }).select("_id name").lean();
  const projectMap = new Map(projects.map((p) => [p._id.toString(), p.name]));

  const totalsResults = await Promise.allSettled(
    docs.map((d) => getEmployeeTotals(d._id.toString(), { startDate: options?.startDate, endDate: options?.endDate }))
  );
  const totalsList = totalsResults.map((r) =>
    r.status === "fulfilled" ? r.value : { totalPaid: 0, totalDue: 0, totalAdvance: 0 }
  );
  const month = options?.month?.trim();
  let snapshots: (MonthlySnapshot | undefined)[] = [];
  if (month) {
    const snapshotResults = await Promise.allSettled(
      docs.map((d) => getEmployeeSnapshotForMonth(d._id.toString(), month, d.createdAt, d.joiningDate, d.type, d.endingDate))
    );
    snapshots = snapshotResults.map((r) => (r.status === "fulfilled" ? r.value : undefined));
  }
  return docs.map((doc, i) => ({
    ...toPayload(doc, projectMap.get(doc.projectId.toString()), { totalPaid: totalsList[i].totalPaid, totalDue: totalsList[i].totalDue, totalAdvance: totalsList[i].totalAdvance }),
    ...(snapshots[i] && { snapshot: snapshots[i] }),
  }));
}

export async function getEmployeeById(
  id: string,
  actor?: { userId: string; role: string }
): Promise<EmployeePayload | null> {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const doc = await Employee.findById(id).lean();
  if (!doc) return null;
  if (actor?.role === "site_manager") {
    const assigned = await getAssignedProjectIds(actor.userId);
    if (!assigned.includes(doc.projectId.toString())) return null;
  }
  const project = await Project.findById(doc.projectId).select("name").lean();
  const totals = await getEmployeeTotals(id);
  return toPayload(doc, project?.name, totals);
}

/** Create employee. Site Manager: uses assigned project. Admin/Super Admin: requires projectId in input. */
export async function createEmployee(
  actor: { userId: string; email: string; role: string },
  input: CreateEmployeeInput
): Promise<EmployeePayload> {
  if (!input.name?.trim()) throw new Error("Employee name is required");
  if (!input.role?.trim()) throw new Error("Employee role is required");
  if (!input.type || !["Fixed", "Daily"].includes(input.type)) throw new Error("Employee type must be Fixed or Daily");
  const category = input.category ?? "Regular";
  if (!['Regular', 'Machinery'].includes(category)) throw new Error("Invalid employee category");
  if (category === "Machinery" && input.type !== "Fixed") throw new Error("Machinery Employees must use Fixed monthly salary");

  let projectId: string;
  if (actor.role === "site_manager") {
    projectId = (await resolveSiteManagerProjectId(actor.userId, input.projectId)) ?? "";
    if (!projectId) throw new Error("Site Manager must be assigned to this project to create employees");
  } else {
    projectId = input.projectId ?? "";
    if (!projectId || !mongoose.Types.ObjectId.isValid(projectId)) throw new Error("Project is required");
  }

  const payload: Record<string, unknown> = {
    projectId: new mongoose.Types.ObjectId(projectId),
    name: input.name.trim(),
    role: input.role.trim(),
    type: input.type,
    phone: (input.phone ?? "").trim(),
  };
  if (input.type === "Fixed" && input.monthlySalary != null) payload.monthlySalary = Math.max(0, input.monthlySalary);
  if (input.type === "Daily" && input.dailyRate != null) payload.dailyRate = Math.max(0, input.dailyRate);
  if (input.joiningDate?.trim()) payload.joiningDate = validateJoiningDate(input.joiningDate);
  if (input.endingDate?.trim()) {
    const endingDate = validateEndingDate(input.endingDate);
    if (payload.joiningDate && endingDate < (payload.joiningDate as string)) {
      throw new Error("Ending date cannot be before joining date");
    }
    payload.endingDate = endingDate;
  }
  payload.category = category;
  if (category === "Machinery") {
    if (!input.machineId || !mongoose.Types.ObjectId.isValid(input.machineId)) throw new Error("A Company Owned machine is required for a Machinery Employee");
    const machine = await Machine.findOne({ _id: input.machineId, projectId, ownership: "Company Owned" }).lean();
    if (!machine) throw new Error("Machinery Employee must be assigned to a Company Owned machine in the same project");
    payload.machineId = machine._id;
  }

  const employee = await Employee.create(payload);

  const actorUser = await User.findById(actor.userId).lean();
  const role = roleDisplay[actor.role as keyof typeof roleDisplay] ?? actor.role;
  await logAudit({
    userId: actor.userId,
    userName: actorUser?.name ?? "Unknown",
    userEmail: actor.email,
    role,
    action: "create",
    module: "employees",
    entityId: employee._id.toString(),
    projectId: employee.projectId?.toString(),
    projectName: await getProjectName(employee.projectId?.toString()),
    description: `Created employee: ${employee.name}`,
    newValue: { name: employee.name, type: employee.type },
  });

  const project = await Project.findById(projectId).select("name").lean();
  return toPayload(employee, project?.name);
}

export async function updateEmployee(
  actor: { userId: string; email: string; role: string },
  id: string,
  input: UpdateEmployeeInput
): Promise<EmployeePayload> {
  if (!mongoose.Types.ObjectId.isValid(id)) throw new Error("Invalid employee ID");

  const target = await Employee.findById(id);
  if (!target) throw new Error("Employee not found");

  const updates: Record<string, unknown> = {};
  if (input.name != null) updates.name = input.name.trim();
  if (input.role != null) updates.role = input.role.trim();
  if (input.type != null) {
    if (!["Fixed", "Daily"].includes(input.type)) throw new Error("Employee type must be Fixed or Daily");
    updates.type = input.type;
  }
  if (input.monthlySalary != null) updates.monthlySalary = Math.max(0, input.monthlySalary);
  if (input.dailyRate != null) updates.dailyRate = Math.max(0, input.dailyRate);
  if (input.phone != null) updates.phone = input.phone.trim();
  if (target.category === "Machinery" && input.machineId != null) {
    if (!mongoose.Types.ObjectId.isValid(input.machineId)) throw new Error("A valid Company Owned machine is required");
    const machine = await Machine.findOne({ _id: input.machineId, projectId: target.projectId, ownership: "Company Owned" }).lean();
    if (!machine) throw new Error("Machinery Employee must be assigned to a Company Owned machine in the same project");
    updates.machineId = machine._id;
  }
  let unsetJoiningDate = false;
  if (input.joiningDate != null) {
    const trimmed = input.joiningDate.trim();
    if (trimmed) {
      updates.joiningDate = validateJoiningDate(trimmed);
    } else {
      unsetJoiningDate = true;
    }
  }
  let unsetEndingDate = false;
  if (input.endingDate != null) {
    const trimmed = input.endingDate.trim();
    if (trimmed) {
      updates.endingDate = validateEndingDate(trimmed);
    } else {
      unsetEndingDate = true;
    }
  }
  const effectiveJoiningDate = (updates.joiningDate as string | undefined) ?? (unsetJoiningDate ? undefined : target.joiningDate);
  if (updates.endingDate != null && effectiveJoiningDate && (updates.endingDate as string) < effectiveJoiningDate) {
    throw new Error("Ending date cannot be before joining date");
  }

  const updateDoc: Record<string, unknown> = { $set: updates };
  const unsetFields: Record<string, string> = {};
  if (unsetJoiningDate) unsetFields.joiningDate = "";
  if (unsetEndingDate) unsetFields.endingDate = "";
  if (Object.keys(unsetFields).length) updateDoc.$unset = unsetFields;

  const updated = await Employee.findByIdAndUpdate(id, updateDoc, { new: true }).lean();
  if (!updated) throw new Error("Update failed");

  const actorUser = await User.findById(actor.userId).lean();
  const role = roleDisplay[actor.role as keyof typeof roleDisplay] ?? actor.role;
  await logAudit({
    userId: actor.userId,
    userName: actorUser?.name ?? "Unknown",
    userEmail: actor.email,
    role,
    action: "update",
    module: "employees",
    entityId: id,
    projectId: target.projectId?.toString(),
    projectName: await getProjectName(target.projectId?.toString()),
    description: `Updated employee: ${target.name}`,
    oldValue: { name: target.name },
    newValue: { name: updated.name },
  });

  const project = await Project.findById(updated.projectId).select("name").lean();
  return toPayload(updated, project?.name);
}

/** Prevent delete if employee has any payment records (referential integrity). */
export async function deleteEmployee(
  actor: { userId: string; email: string; role: string },
  id: string
): Promise<void> {
  if (!mongoose.Types.ObjectId.isValid(id)) throw new Error("Invalid employee ID");

  const target = await Employee.findById(id);
  if (!target) throw new Error("Employee not found");

  const paymentCount = await EmployeePayment.countDocuments({ employeeId: new mongoose.Types.ObjectId(id) });
  if (paymentCount > 0) {
    throw new Error(
      `Cannot delete employee "${target.name}": ${paymentCount} payment record(s) exist. Remove or reassign payments first.`
    );
  }

  await Employee.findByIdAndDelete(id);

  const actorUser = await User.findById(actor.userId).lean();
  const role = roleDisplay[actor.role as keyof typeof roleDisplay] ?? actor.role;
  await logAudit({
    userId: actor.userId,
    userName: actorUser?.name ?? "Unknown",
    userEmail: actor.email,
    role,
    action: "delete",
    module: "employees",
    entityId: id,
    projectId: target.projectId?.toString(),
    projectName: await getProjectName(target.projectId?.toString()),
    description: `Deleted employee: ${target.name}`,
    oldValue: { name: target.name },
  });
}
