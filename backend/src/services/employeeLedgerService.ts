import mongoose from "mongoose";
import { Employee } from "../models/Employee.js";
import { EmployeePayment } from "../models/EmployeePayment.js";
import { EmployeeAttendance } from "../models/EmployeeAttendance.js";
import { User } from "../models/User.js";
import { logAudit } from "./auditService.js";
import { roleDisplay } from "./authService.js";
import type { IEmployee } from "../models/Employee.js";
import type { IEmployeePayment } from "../models/EmployeePayment.js";
import type { IEmployeeAttendance } from "../models/EmployeeAttendance.js";

export const GLOBAL_ALLOWED_LEAVES_DEFAULT = 4;

function getDaysInMonth(month: string): number {
  const [year, monthNum] = month.split("-").map(Number);
  return new Date(year, monthNum, 0).getDate();
}

function roundAmount(value: number): number {
  return Math.round(value);
}

function monthEndDate(month: string): string {
  const days = getDaysInMonth(month);
  return `${month}-${String(days).padStart(2, "0")}`;
}

/** Build day -> status map from fixed entries */
function fixedMap(attendance: IEmployeeAttendance | null): Record<number, string> {
  const out: Record<number, string> = {};
  if (!attendance?.fixedEntries?.length) return out;
  for (const e of attendance.fixedEntries) {
    out[e.day] = e.status;
  }
  return out;
}

/** Build day -> { hoursWorked, overtimeHours, status } from daily entries */
function dailyMap(attendance: IEmployeeAttendance | null): Record<number, { hoursWorked: number; overtimeHours: number; status: string }> {
  const out: Record<number, { hoursWorked: number; overtimeHours: number; status: string }> = {};
  if (!attendance?.dailyEntries?.length) return out;
  for (const e of attendance.dailyEntries) {
    out[e.day] = { hoursWorked: e.hoursWorked ?? 0, overtimeHours: e.overtimeHours ?? 0, status: e.status };
  }
  return out;
}

/** Build day -> status map from explicit fixed entries array */
function fixedMapFromEntries(entries: { day: number; status: string }[] | undefined): Record<number, string> {
  const out: Record<number, string> = {};
  if (!entries?.length) return out;
  for (const e of entries) out[e.day] = e.status;
  return out;
}

/** Build day -> entry from explicit daily entries array */
function dailyMapFromEntries(
  entries: { day: number; hoursWorked?: number; overtimeHours?: number; status: string }[] | undefined
): Record<number, { hoursWorked: number; overtimeHours: number; status: string }> {
  const out: Record<number, { hoursWorked: number; overtimeHours: number; status: string }> = {};
  if (!entries?.length) return out;
  for (const e of entries) {
    out[e.day] = { hoursWorked: e.hoursWorked ?? 0, overtimeHours: e.overtimeHours ?? 0, status: e.status };
  }
  return out;
}

/**
 * Compute payable from explicit attendance entries (no DB read). Used to validate before saving.
 */
function computePayableFromEntries(
  employee: { type: string; monthlySalary?: number; dailyRate?: number },
  month: string,
  fixedEntries: { day: number; status: string }[] | undefined,
  dailyEntries: { day: number; hoursWorked?: number; overtimeHours?: number; status: string }[] | undefined,
  globalAllowedLeaves: number = GLOBAL_ALLOWED_LEAVES_DEFAULT
): number {
  if (employee.type === "Fixed") {
    const fixedAttendance = fixedMapFromEntries(fixedEntries);
    const baseSalary = employee.monthlySalary ?? 0;
    const unpaidLeaveDays = Object.entries(fixedAttendance)
      .filter(([, status]) => status === "unpaid_leave")
      .map(([day]) => Number(day));
    const unpaidLeaves = unpaidLeaveDays.length;
    const unpaidLeaveDeduction = roundAmount((baseSalary / getDaysInMonth(month)) * unpaidLeaves);
    return Math.max(baseSalary - unpaidLeaveDeduction, 0);
  }

  const dailyAttendance = dailyMapFromEntries(dailyEntries);
  const presentDays = Object.values(dailyAttendance).filter((e) => e.status === "present");
  const overtimeHours = presentDays.reduce((t, e) => t + Math.max(e.overtimeHours, 0), 0);
  const workedDays = presentDays.reduce(
    (t, e) => t + Math.min(Math.max(e.hoursWorked, 0), 8) / 8,
    0
  );
  const dailyRate = employee.dailyRate ?? 0;
  const overtimeRate = dailyRate / 8;
  const dailyWageComponent = roundAmount(workedDays * dailyRate);
  const overtimePay = roundAmount(overtimeHours * overtimeRate);
  return dailyWageComponent + overtimePay;
}

/**
 * Compute payable for an employee for a given month from attendance and employee type/rate.
 * Uses same rules as frontend: Fixed = baseSalary - unpaidLeaveDeduction; Daily = dailyWage + overtimePay.
 */
export async function computePayableForMonth(
  employeeId: string,
  month: string,
  globalAllowedLeaves: number = GLOBAL_ALLOWED_LEAVES_DEFAULT
): Promise<number> {
  const employee = await Employee.findById(employeeId).lean();
  if (!employee) return 0;

  const firstMonth = employee.createdAt
    ? new Date(employee.createdAt).toISOString().slice(0, 7)
    : null;
  if (firstMonth && month < firstMonth) return 0;

  const attendance = await EmployeeAttendance.findOne({ employeeId: new mongoose.Types.ObjectId(employeeId), month }).lean();

  if (employee.type === "Fixed") {
    const fixedAttendance = fixedMap(attendance ?? null);
    const baseSalary = employee.monthlySalary ?? 0;
    const unpaidLeaveDays = Object.entries(fixedAttendance)
      .filter(([, status]) => status === "unpaid_leave")
      .map(([day]) => Number(day));
    const unpaidLeaves = unpaidLeaveDays.length;
    const unpaidLeaveDeduction = roundAmount((baseSalary / getDaysInMonth(month)) * unpaidLeaves);
    return Math.max(baseSalary - unpaidLeaveDeduction, 0);
  }

  const dailyAttendance = dailyMap(attendance ?? null);
  const presentDays = Object.values(dailyAttendance).filter((e) => e.status === "present");
  const overtimeHours = presentDays.reduce((t, e) => t + Math.max(e.overtimeHours, 0), 0);
  const workedDays = presentDays.reduce(
    (t, e) => t + Math.min(Math.max(e.hoursWorked, 0), 8) / 8,
    0
  );
  const dailyRate = employee.dailyRate ?? 0;
  const overtimeRate = dailyRate / 8;
  const dailyWageComponent = roundAmount(workedDays * dailyRate);
  const overtimePay = roundAmount(overtimeHours * overtimeRate);
  return dailyWageComponent + overtimePay;
}

export interface AttendanceSummaryFixed {
  type: "Fixed";
  present: number;
  absent: number;
  paidLeave: number;
  unpaidLeave: number;
}

export interface AttendanceSummaryDaily {
  type: "Daily";
  workedDays: number;
  overtimeHours: number;
}

export type AttendanceSummary = AttendanceSummaryFixed | AttendanceSummaryDaily | undefined;

/** Get attendance summary for one employee for one month. Returns undefined when month is before employee creation. */
export async function getAttendanceSummaryForMonth(
  employeeId: string,
  month: string,
  globalAllowedLeaves: number = GLOBAL_ALLOWED_LEAVES_DEFAULT
): Promise<AttendanceSummary> {
  const employee = await Employee.findById(employeeId).select("type createdAt").lean();
  if (!employee) return undefined;
  const firstMonth = employee.createdAt
    ? new Date(employee.createdAt).toISOString().slice(0, 7)
    : null;
  if (firstMonth && month < firstMonth) return undefined;

  const attendance = await EmployeeAttendance.findOne({ employeeId: new mongoose.Types.ObjectId(employeeId), month }).lean();
  const totalDays = getDaysInMonth(month);

  if (employee.type === "Fixed") {
    const fixedAttendance = fixedMap(attendance ?? null);
    let present = 0;
    let absent = 0;
    const explicitPaidLeaveDays: number[] = [];
    const explicitUnpaidLeaveDays: number[] = [];
    const legacyLeaveDays: number[] = [];
    for (let day = 1; day <= totalDays; day++) {
      const status = fixedAttendance[day] ?? "present";
      if (status === "present") present += 1;
      else if (status === "absent") absent += 1;
      else if (status === "paid_leave") explicitPaidLeaveDays.push(day);
      else if (status === "unpaid_leave") explicitUnpaidLeaveDays.push(day);
      else if (status === "leave") legacyLeaveDays.push(day);
      else present += 1; // fallback
    }
    const paidLeave = explicitPaidLeaveDays.length + legacyLeaveDays.length;
    const unpaidLeave = explicitUnpaidLeaveDays.length;
    return { type: "Fixed", present, absent, paidLeave, unpaidLeave };
  }

  const dailyAttendance = dailyMap(attendance ?? null);
  const presentDays = Object.values(dailyAttendance).filter((e) => e.status === "present");
  const overtimeHours = presentDays.reduce((t, e) => t + Math.max(e.overtimeHours, 0), 0);
  const workedDays = presentDays.reduce(
    (t, e) => t + Math.min(Math.max(e.hoursWorked, 0), 8) / 8,
    0
  );
  return { type: "Daily", workedDays, overtimeHours };
}

/** Sum of all payment amounts for this employee (for list view; avoids expensive totalDue loop). */
export async function getEmployeeTotalPaidOnly(employeeId: string): Promise<number> {
  if (!mongoose.Types.ObjectId.isValid(employeeId)) return 0;
  const oid = new mongoose.Types.ObjectId(employeeId);
  const result = await EmployeePayment.aggregate([
    { $match: { employeeId: oid } },
    { $group: { _id: null, total: { $sum: "$amount" } } },
  ]);
  return result[0]?.total ?? 0;
}

/** Get snapshot (payable, paid, remaining, paymentStatus) for one employee for one month.
 * Returns undefined when the month is before the employee's creation (no data for that period).
 * Pass employeeCreatedAt when caller already has it to avoid extra Employee.findById. */
export async function getEmployeeSnapshotForMonth(
  employeeId: string,
  month: string,
  employeeCreatedAt?: Date
): Promise<MonthlySnapshot | undefined> {
  let firstMonth: string | null = null;
  if (employeeCreatedAt != null) {
    firstMonth = new Date(employeeCreatedAt).toISOString().slice(0, 7);
  } else {
    const employee = await Employee.findById(employeeId).select("createdAt").lean();
    if (!employee) return undefined;
    firstMonth = employee.createdAt ? new Date(employee.createdAt).toISOString().slice(0, 7) : null;
  }
  if (firstMonth && month < firstMonth) return undefined;

  const [payable, paid, advancePaid, attendance, lastNonAdvance] = await Promise.all([
    computePayableForMonth(employeeId, month),
    getMonthPaid(employeeId, month),
    getMonthAdvancePaid(employeeId, month),
    getAttendanceSummaryForMonth(employeeId, month),
    EmployeePayment.findOne(
      { employeeId: new mongoose.Types.ObjectId(employeeId), month, type: { $ne: "Advance" } }
    )
      .sort({ date: -1 })
      .select("date")
      .lean(),
  ]);
  const remaining = Math.max(0, payable - paid);
  const monthEnd = monthEndDate(month);
  const settlementDate = lastNonAdvance?.date ?? null;
  return {
    payable,
    paid,
    remaining,
    advancePaid,
    paymentStatus: paymentStatus(payable, paid, remaining, settlementDate, monthEnd),
    ...(attendance && { attendance }),
  };
}

/** Current month in YYYY-MM format. */
function getCurrentMonth(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** List months from firstMonth (inclusive) through currentMonth (inclusive). */
function monthsFromTo(firstMonth: string, currentMonth: string): string[] {
  if (firstMonth > currentMonth) return [];
  const [fy, fm] = firstMonth.split("-").map(Number);
  const [cy, cm] = currentMonth.split("-").map(Number);
  const out: string[] = [];
  let y = fy;
  let m = fm;
  while (y < cy || (y === cy && m <= cm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** Aggregate totalPaid (sum of all payments) and totalDue (sum of remaining per month) for an employee.
 * Includes the current month in totalDue so pending salary for the current month is reflected. */
export async function getEmployeeTotals(employeeId: string): Promise<{ totalPaid: number; totalDue: number }> {
  if (!mongoose.Types.ObjectId.isValid(employeeId)) {
    return { totalPaid: 0, totalDue: 0 };
  }
  const oid = new mongoose.Types.ObjectId(employeeId);
  const currentMonth = getCurrentMonth();
  const [employee, paidAgg, paymentMonths, attendanceMonths] = await Promise.all([
    Employee.findById(employeeId).select("createdAt").lean(),
    EmployeePayment.aggregate([{ $match: { employeeId: oid } }, { $group: { _id: null, total: { $sum: "$amount" } } }]),
    EmployeePayment.distinct("month", { employeeId: oid }),
    EmployeeAttendance.distinct("month", { employeeId: oid }),
  ]);
  const totalPaid = paidAgg[0]?.total ?? 0;
  const firstMonth = employee?.createdAt ? new Date(employee.createdAt).toISOString().slice(0, 7) : "1970-01";
  const monthsUpToCurrent = monthsFromTo(firstMonth, currentMonth);
  const months = [...new Set([...paymentMonths, ...attendanceMonths, ...monthsUpToCurrent])].filter(
    (m) => m >= firstMonth && m <= currentMonth
  );
  let totalDue = 0;
  for (const month of months) {
    const payable = await computePayableForMonth(employeeId, month);
    const paid = await getMonthPaid(employeeId, month);
    totalDue += Math.max(0, payable - paid);
  }
  return { totalPaid, totalDue };
}

/** Sum of all payment amounts for this employee and month. */
export async function getMonthPaid(employeeId: string, month: string): Promise<number> {
  const result = await EmployeePayment.aggregate([
    { $match: { employeeId: new mongoose.Types.ObjectId(employeeId), month } },
    { $group: { _id: null, total: { $sum: "$amount" } } },
  ]);
  return result[0]?.total ?? 0;
}

/** Sum of Advance-type payments for this employee and month (salary sheet / net payable). */
export async function getMonthAdvancePaid(employeeId: string, month: string): Promise<number> {
  const result = await EmployeePayment.aggregate([
    {
      $match: {
        employeeId: new mongoose.Types.ObjectId(employeeId),
        month,
        type: "Advance",
      },
    },
    { $group: { _id: null, total: { $sum: "$amount" } } },
  ]);
  return result[0]?.total ?? 0;
}

/** Validation: can we add this payment? Amount > 0 and currentPaid + amount <= payable. */
async function validateAddPayment(
  employeeId: string,
  month: string,
  amount: number,
  globalAllowedLeaves: number
): Promise<void> {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Amount must be greater than zero.");
  }
  const payable = await computePayableForMonth(employeeId, month, globalAllowedLeaves);
  if (payable <= 0) {
    throw new Error(
      "No dues for this month. The employee did not exist or has no payable amount for the selected month."
    );
  }
  const currentPaid = await getMonthPaid(employeeId, month);
  if (currentPaid + amount > payable) {
    const maxAllowed = Math.max(0, Math.round(payable - currentPaid));
    throw new Error(
      `Total paid for this month would exceed payable (${payable.toLocaleString()}). Maximum allowed: ${maxAllowed.toLocaleString()}.`
    );
  }
}

/** Validation: can we apply this edit? Same logic as frontend canEditPayment. */
async function validateEditPayment(
  payment: IEmployeePayment,
  employeeId: string,
  newAmount: number,
  newMonth: string,
  globalAllowedLeaves: number
): Promise<void> {
  if (!Number.isFinite(newAmount) || newAmount <= 0) {
    throw new Error("Amount must be greater than zero.");
  }
  const oldMonth = payment.month;
  const oldAmount = payment.amount;

  if (newMonth === oldMonth) {
    const payable = await computePayableForMonth(employeeId, oldMonth, globalAllowedLeaves);
    const currentPaid = await getMonthPaid(employeeId, oldMonth);
    const paidAfterEdit = currentPaid - oldAmount + newAmount;
    if (paidAfterEdit > payable) {
      const maxAllowed = Math.max(0, Math.round(payable - (currentPaid - oldAmount)));
      throw new Error(
        `Total paid for this month would exceed payable (${payable.toLocaleString()}). Maximum allowed: ${maxAllowed.toLocaleString()}.`
      );
    }
    return;
  }

  const payableOld = await computePayableForMonth(employeeId, oldMonth, globalAllowedLeaves);
  const payableNew = await computePayableForMonth(employeeId, newMonth, globalAllowedLeaves);
  const paidOld = await getMonthPaid(employeeId, oldMonth);
  const paidNew = await getMonthPaid(employeeId, newMonth);
  const paidOldAfterEdit = paidOld - oldAmount;
  const paidNewAfterEdit = paidNew + newAmount;

  if (paidOldAfterEdit > payableOld) {
    throw new Error("After moving this payment, total paid for the original month would exceed payable.");
  }
  if (paidNewAfterEdit > payableNew) {
    const maxAllowed = Math.max(0, Math.round(payableNew - paidNew));
    throw new Error(
      `Total paid for the new month would exceed payable (${payableNew.toLocaleString()}). Maximum allowed: ${maxAllowed.toLocaleString()}.`
    );
  }
}

export interface EmployeePaymentPayload {
  id: string;
  employeeId: string;
  month: string;
  date: string;
  amount: number;
  type: string;
  paymentMethod: string;
  remarks?: string;
}

export interface CreateEmployeePaymentInput {
  month: string;
  date: string;
  amount: number;
  type: "Advance" | "Salary" | "Wage";
  paymentMethod: "Cash" | "Bank" | "Online";
  remarks?: string;
}

export interface UpdateEmployeePaymentInput {
  month?: string;
  date?: string;
  amount?: number;
  type?: "Advance" | "Salary" | "Wage";
  paymentMethod?: "Cash" | "Bank" | "Online";
  remarks?: string;
}

export type AttendanceSnapshot = AttendanceSummaryFixed | AttendanceSummaryDaily;

export interface MonthlySnapshot {
  payable: number;
  paid: number;
  remaining: number;
  /** Sum of Advance payments recorded for this month (for salary sheet net). */
  advancePaid: number;
  paymentStatus: "Paid" | "Partial" | "Due" | "Late";
  attendance?: AttendanceSnapshot;
}

function paymentStatus(payable: number, paid: number, remaining: number, settlementDate: string | null, monthEnd: string): "Paid" | "Partial" | "Due" | "Late" {
  if (payable <= 0) return "Paid";
  if (remaining <= 0) {
    if (settlementDate && settlementDate > monthEnd) return "Late";
    return "Paid";
  }
  if (paid > 0) return "Partial";
  return "Due";
}

function toPaymentPayload(doc: IEmployeePayment): EmployeePaymentPayload {
  return {
    id: doc._id.toString(),
    employeeId: doc.employeeId.toString(),
    month: doc.month,
    date: doc.date,
    amount: doc.amount,
    type: doc.type,
    paymentMethod: doc.paymentMethod,
    remarks: doc.remarks,
  };
}

/** Ensure actor can access this employee (project scope). Site Manager: employee must be in assigned project. */
async function ensureEmployeeAccess(actor: { userId: string; role: string }, employeeId: string): Promise<IEmployee> {
  const employee = await Employee.findById(employeeId).lean();
  if (!employee) throw new Error("Employee not found");
  if (actor.role === "site_manager") {
    const user = await User.findById(actor.userId).select("assignedProjectId").lean();
    const assignedId = user?.assignedProjectId?.toString();
    if (assignedId !== employee.projectId.toString()) {
      throw new Error("Employee not found");
    }
  }
  return employee;
}

export async function createEmployeePayment(
  actor: { userId: string; email: string; role: string },
  employeeId: string,
  input: CreateEmployeePaymentInput
): Promise<EmployeePaymentPayload> {
  if (!mongoose.Types.ObjectId.isValid(employeeId)) throw new Error("Invalid employee ID");
  await ensureEmployeeAccess(actor, employeeId);

  if (!input.month?.trim() || !input.date?.trim()) throw new Error("Month and date are required");
  if (!["Advance", "Salary", "Wage"].includes(input.type)) throw new Error("Invalid payment type");
  if (!["Cash", "Bank", "Online"].includes(input.paymentMethod)) throw new Error("Invalid payment method");

  await validateAddPayment(employeeId, input.month, input.amount, GLOBAL_ALLOWED_LEAVES_DEFAULT);

  const payment = await EmployeePayment.create({
    employeeId: new mongoose.Types.ObjectId(employeeId),
    month: input.month.trim(),
    date: input.date.trim(),
    amount: input.amount,
    type: input.type,
    paymentMethod: input.paymentMethod,
    remarks: input.remarks?.trim(),
  });

  const employee = await Employee.findById(employeeId).select("name").lean();
  const actorUser = await User.findById(actor.userId).lean();
  const role = roleDisplay[actor.role as keyof typeof roleDisplay] ?? actor.role;
  await logAudit({
    userId: actor.userId,
    userName: actorUser?.name ?? "Unknown",
    userEmail: actor.email,
    role,
    action: "create",
    module: "employees",
    entityId: payment._id.toString(),
    description: `Payment recorded: ${employee?.name ?? "Employee"} - ${payment.type} ${payment.amount.toLocaleString()} (${payment.month})`,
    newValue: { amount: payment.amount, type: payment.type, month: payment.month },
  });

  return toPaymentPayload(payment);
}

export async function updateEmployeePayment(
  actor: { userId: string; email: string; role: string },
  paymentId: string,
  input: UpdateEmployeePaymentInput
): Promise<EmployeePaymentPayload> {
  if (!mongoose.Types.ObjectId.isValid(paymentId)) throw new Error("Invalid payment ID");

  const payment = await EmployeePayment.findById(paymentId);
  if (!payment) throw new Error("Payment not found");

  await ensureEmployeeAccess(actor, payment.employeeId.toString());

  const newAmount = input.amount ?? payment.amount;
  const newMonth = (input.month ?? payment.month).trim();

  await validateEditPayment(payment, payment.employeeId.toString(), newAmount, newMonth, GLOBAL_ALLOWED_LEAVES_DEFAULT);

  const updates: Record<string, unknown> = {};
  if (input.month != null) updates.month = input.month.trim();
  if (input.date != null) updates.date = input.date.trim();
  if (input.amount != null) updates.amount = input.amount;
  if (input.type != null) updates.type = input.type;
  if (input.paymentMethod != null) updates.paymentMethod = input.paymentMethod;
  if (input.remarks != null) updates.remarks = input.remarks.trim();

  const updated = await EmployeePayment.findByIdAndUpdate(paymentId, updates, { new: true });
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
    entityId: paymentId,
    description: `Updated payment: ${updated.amount} (${updated.month})`,
    oldValue: { amount: payment.amount, month: payment.month },
    newValue: { amount: updated.amount, month: updated.month },
  });

  return toPaymentPayload(updated);
}

export async function deleteEmployeePayment(
  actor: { userId: string; email: string; role: string },
  paymentId: string
): Promise<void> {
  if (!mongoose.Types.ObjectId.isValid(paymentId)) throw new Error("Invalid payment ID");

  const payment = await EmployeePayment.findById(paymentId);
  if (!payment) throw new Error("Payment not found");

  await ensureEmployeeAccess(actor, payment.employeeId.toString());

  await EmployeePayment.findByIdAndDelete(paymentId);

  const actorUser = await User.findById(actor.userId).lean();
  const role = roleDisplay[actor.role as keyof typeof roleDisplay] ?? actor.role;
  await logAudit({
    userId: actor.userId,
    userName: actorUser?.name ?? "Unknown",
    userEmail: actor.email,
    role,
    action: "delete",
    module: "employees",
    entityId: paymentId,
    description: `Deleted payment: ${payment.amount} (${payment.month})`,
    oldValue: { amount: payment.amount, month: payment.month },
  });
}

export interface GetEmployeeLedgerOptions {
  month?: string;
  page?: number;
  pageSize?: number;
}

const DEFAULT_PAGE_SIZE = 12;

export interface GetEmployeeLedgerResult {
  payments: EmployeePaymentPayload[];
  total: number;
  snapshot?: MonthlySnapshot;
}

export async function getEmployeeLedger(
  actor: { userId: string; role: string },
  employeeId: string,
  options?: GetEmployeeLedgerOptions
): Promise<GetEmployeeLedgerResult> {
  if (!mongoose.Types.ObjectId.isValid(employeeId)) {
    return { payments: [], total: 0 };
  }

  await ensureEmployeeAccess(actor, employeeId);

  const page = Math.max(1, options?.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, options?.pageSize ?? DEFAULT_PAGE_SIZE));
  const baseMatch = { employeeId: new mongoose.Types.ObjectId(employeeId) };

  // Payments ledger: always return all records, sorted by date descending (unaffected by month filter)
  const [total, paymentDocs] = await Promise.all([
    EmployeePayment.countDocuments(baseMatch),
    EmployeePayment.find(baseMatch)
      .sort({ date: -1, month: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
  ]);

  const payments = paymentDocs.map((doc) => toPaymentPayload(doc));

  let snapshot: MonthlySnapshot | undefined;
  const month = options?.month?.trim();
  if (month) {
    const payable = await computePayableForMonth(employeeId, month);
    const paid = await getMonthPaid(employeeId, month);
    const advancePaid = await getMonthAdvancePaid(employeeId, month);
    const remaining = Math.max(0, payable - paid);
    const monthEnd = monthEndDate(month);
    const lastNonAdvance = await EmployeePayment.findOne(
      { employeeId: new mongoose.Types.ObjectId(employeeId), month, type: { $ne: "Advance" } }
    )
      .sort({ date: -1 })
      .select("date")
      .lean();
    const settlementDate = lastNonAdvance?.date ?? null;
    snapshot = {
      payable,
      paid,
      remaining,
      advancePaid,
      paymentStatus: paymentStatus(payable, paid, remaining, settlementDate, monthEnd),
    };
  }

  return { payments, total, snapshot };
}

/** Get only the monthly snapshot (payable, paid, remaining, paymentStatus) for an employee. Used when month changes so payments list is not refetched. */
export async function getEmployeeLedgerSnapshot(
  actor: { userId: string; role: string },
  employeeId: string,
  month: string
): Promise<{ snapshot: MonthlySnapshot } | { snapshot: null }> {
  if (!mongoose.Types.ObjectId.isValid(employeeId) || !month?.trim()) {
    return { snapshot: null };
  }
  await ensureEmployeeAccess(actor, employeeId);
  const m = month.trim();
  const payable = await computePayableForMonth(employeeId, m);
  const paid = await getMonthPaid(employeeId, m);
  const advancePaid = await getMonthAdvancePaid(employeeId, m);
  const remaining = Math.max(0, payable - paid);
  const monthEnd = monthEndDate(m);
  const lastNonAdvance = await EmployeePayment.findOne(
    { employeeId: new mongoose.Types.ObjectId(employeeId), month: m, type: { $ne: "Advance" } }
  )
    .sort({ date: -1 })
    .select("date")
    .lean();
  const settlementDate = lastNonAdvance?.date ?? null;
  const snapshot: MonthlySnapshot = {
    payable,
    paid,
    remaining,
    advancePaid,
    paymentStatus: paymentStatus(payable, paid, remaining, settlementDate, monthEnd),
  };
  return { snapshot };
}

export interface AttendancePayload {
  month: string;
  fixedEntries: { day: number; status: string }[];
  dailyEntries: { day: number; hoursWorked: number; overtimeHours: number; status: string; notes?: string }[];
}

export interface PutAttendanceInput {
  month: string;
  fixedEntries?: { day: number; status: string }[];
  dailyEntries?: { day: number; hoursWorked: number; overtimeHours: number; status: string; notes?: string }[];
}

export async function getAttendance(
  actor: { userId: string; role: string },
  employeeId: string,
  month: string
): Promise<AttendancePayload> {
  await ensureEmployeeAccess(actor, employeeId);
  const doc = await EmployeeAttendance.findOne({
    employeeId: new mongoose.Types.ObjectId(employeeId),
    month: month.trim(),
  }).lean();
  return {
    month: month.trim(),
    fixedEntries: doc?.fixedEntries ?? [],
    dailyEntries: doc?.dailyEntries ?? [],
  };
}

/**
 * Validate that saving this attendance would not make PAID > PAYABLE for the month.
 * If salary is already paid, marking unpaid leave (or reducing payable) is not allowed.
 */
async function validateAttendanceWontReducePayableBelowPaid(
  employeeId: string,
  month: string,
  input: PutAttendanceInput
): Promise<void> {
  const employee = await Employee.findById(employeeId).lean();
  if (!employee) return;

  const existing = await EmployeeAttendance.findOne({
    employeeId: new mongoose.Types.ObjectId(employeeId),
    month,
  }).lean();

  const resultingFixedEntries = input.fixedEntries ?? existing?.fixedEntries ?? [];
  const resultingDailyEntries = input.dailyEntries ?? existing?.dailyEntries ?? [];

  const newPayable = computePayableFromEntries(
    employee,
    month,
    resultingFixedEntries,
    resultingDailyEntries,
    GLOBAL_ALLOWED_LEAVES_DEFAULT
  );
  const paid = await getMonthPaid(employeeId, month);

  if (paid > newPayable) {
    throw new Error(
      `Cannot save attendance: salary for ${month} has already been paid (${paid.toLocaleString()}). ` +
        `This change would reduce Total Payable to ${newPayable.toLocaleString()}, which would be less than Paid. ` +
        `Please record an adjustment (e.g. refund or correction) before changing attendance.`
    );
  }
}

export async function putAttendance(
  actor: { userId: string; email: string; role: string },
  employeeId: string,
  input: PutAttendanceInput
): Promise<AttendancePayload> {
  await ensureEmployeeAccess(actor, employeeId);
  const month = input.month?.trim();
  if (!month) throw new Error("Month is required");

  await validateAttendanceWontReducePayableBelowPaid(employeeId, month, input);

  const update: Record<string, unknown> = { month };
  if (input.fixedEntries != null) update.fixedEntries = input.fixedEntries;
  if (input.dailyEntries != null) update.dailyEntries = input.dailyEntries;

  const doc = await EmployeeAttendance.findOneAndUpdate(
    { employeeId: new mongoose.Types.ObjectId(employeeId), month },
    { $set: update },
    { new: true, upsert: true }
  ).lean();

  return {
    month: doc.month,
    fixedEntries: doc.fixedEntries ?? [],
    dailyEntries: doc.dailyEntries ?? [],
  };
}
