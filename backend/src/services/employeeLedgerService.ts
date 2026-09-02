import mongoose from "mongoose";
import { Employee } from "../models/Employee.js";
import { EmployeePayment } from "../models/EmployeePayment.js";
import { EmployeeAttendance } from "../models/EmployeeAttendance.js";
import { MachinePayment } from "../models/MachinePayment.js";
import { rebuildMachinePaymentAllocations } from "./machinePaymentAllocationService.js";
import { User } from "../models/User.js";
import { isProjectAssignedToUser } from "./projectAccessService.js";
import { logAudit, getProjectName } from "./auditService.js";
import { roleDisplay } from "./authService.js";
import type { IEmployee } from "../models/Employee.js";
import type { IEmployeePayment } from "../models/EmployeePayment.js";
import type { IEmployeeAttendance } from "../models/EmployeeAttendance.js";
import { monthKeyPKT } from "../lib/pktDate.js";

export const GLOBAL_ALLOWED_LEAVES_DEFAULT = 4;

function getDaysInMonth(month: string): number {
  const [year, monthNum] = month.split("-").map(Number);
  return new Date(year, monthNum, 0).getDate();
}

/** Round to 2 decimal places (paisa) — not to whole rupees, so fractional rates/proration aren't lost. */
function roundAmount(value: number): number {
  return Math.round(value * 100) / 100;
}

function monthEndDate(month: string): string {
  const days = getDaysInMonth(month);
  return `${month}-${String(days).padStart(2, "0")}`;
}

function nextMonth(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(year, monthNumber, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** First month (YYYY-MM) the employee is eligible for salary/attendance data.
 * Prefers the user-specified joiningDate over the DB-insert createdAt timestamp. */
function effectiveFirstMonth(employee: { joiningDate?: string; createdAt?: Date }): string | null {
  if (employee.joiningDate?.trim()) return employee.joiningDate.trim().slice(0, 7);
  return employee.createdAt ? monthKeyPKT(new Date(employee.createdAt)) : null;
}

/** Last month (YYYY-MM) the employee is eligible for salary/attendance data, or null when still active.
 * Once set (via endingDate — the employee has left), no payable accrues for any month after this one;
 * the ending month itself is prorated up to the ending day (see endingDayInMonth). */
function effectiveLastMonth(employee: { endingDate?: string }): string | null {
  if (employee.endingDate?.trim()) return employee.endingDate.trim().slice(0, 7);
  return null;
}

/** When `month` is the employee's final month (per endingDate), returns the last paid day-of-month
 * for proration; otherwise null (no truncation applies). */
function endingDayInMonth(employee: { endingDate?: string }, month: string): number | null {
  const lastMonth = effectiveLastMonth(employee);
  if (!lastMonth || lastMonth !== month) return null;
  return Number(employee.endingDate!.trim().slice(8, 10));
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
  employee: { type: string; monthlySalary?: number; dailyRate?: number; endingDate?: string },
  month: string,
  fixedEntries: { day: number; status: string }[] | undefined,
  dailyEntries: { day: number; hoursWorked?: number; overtimeHours?: number; status: string }[] | undefined,
  globalAllowedLeaves: number = GLOBAL_ALLOWED_LEAVES_DEFAULT
): number {
  const endingDay = endingDayInMonth(employee, month);

  if (employee.type === "Fixed") {
    const fixedAttendance = fixedMapFromEntries(fixedEntries);
    const baseSalary = employee.monthlySalary ?? 0;
    const unpaidLeaveDaySet = new Set<number>(
      Object.entries(fixedAttendance)
        .filter(([, status]) => status === "unpaid_leave")
        .map(([day]) => Number(day))
    );
    if (endingDay != null) {
      const totalDays = getDaysInMonth(month);
      for (let day = endingDay + 1; day <= totalDays; day++) unpaidLeaveDaySet.add(day);
    }
    const unpaidLeaves = unpaidLeaveDaySet.size;
    const unpaidLeaveDeduction = roundAmount((baseSalary / 30) * unpaidLeaves);
    return Math.max(baseSalary - unpaidLeaveDeduction, 0);
  }

  const dailyAttendance = dailyMapFromEntries(dailyEntries);
  const dailyEntryPairs =
    endingDay != null
      ? Object.entries(dailyAttendance).filter(([day]) => Number(day) <= endingDay)
      : Object.entries(dailyAttendance);
  const presentDays = dailyEntryPairs.map(([, e]) => e).filter((e) => e.status === "present");
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

  const firstMonth = effectiveFirstMonth(employee);
  if (firstMonth && month < firstMonth) return 0;
  const lastMonth = effectiveLastMonth(employee);
  if (lastMonth && month > lastMonth) return 0;
  const endingDay = endingDayInMonth(employee, month);

  const attendance = await EmployeeAttendance.findOne({ employeeId: new mongoose.Types.ObjectId(employeeId), month }).lean();

  if (employee.type === "Fixed") {
    const fixedAttendance = fixedMap(attendance ?? null);
    const baseSalary = employee.monthlySalary ?? 0;
    const unpaidLeaveDaySet = new Set<number>(
      Object.entries(fixedAttendance)
        .filter(([, status]) => status === "unpaid_leave")
        .map(([day]) => Number(day))
    );
    // Employee left partway through this month: days after the ending day accrue no salary,
    // same as an unpaid leave day.
    if (endingDay != null) {
      const totalDays = getDaysInMonth(month);
      for (let day = endingDay + 1; day <= totalDays; day++) unpaidLeaveDaySet.add(day);
    }
    const unpaidLeaves = unpaidLeaveDaySet.size;
    // Fixed monthly salaries use a consistent 30-day payroll basis.
    const unpaidLeaveDeduction = roundAmount((baseSalary / 30) * unpaidLeaves);
    return Math.max(baseSalary - unpaidLeaveDeduction, 0);
  }

  const dailyAttendance = dailyMap(attendance ?? null);
  const dailyEntryPairs =
    endingDay != null
      ? Object.entries(dailyAttendance).filter(([day]) => Number(day) <= endingDay)
      : Object.entries(dailyAttendance);
  const presentDays = dailyEntryPairs.map(([, e]) => e).filter((e) => e.status === "present");
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
  const employee = await Employee.findById(employeeId).select("type createdAt joiningDate endingDate").lean();
  if (!employee) return undefined;
  const firstMonth = effectiveFirstMonth(employee);
  if (firstMonth && month < firstMonth) return undefined;
  const lastMonth = effectiveLastMonth(employee);
  if (lastMonth && month > lastMonth) return undefined;
  const endingDay = endingDayInMonth(employee, month);

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
      if (endingDay != null && day > endingDay) {
        // Employee had already left — count as unpaid, regardless of any recorded status.
        explicitUnpaidLeaveDays.push(day);
        continue;
      }
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
  const dailyEntryPairs =
    endingDay != null
      ? Object.entries(dailyAttendance).filter(([day]) => Number(day) <= endingDay)
      : Object.entries(dailyAttendance);
  const presentDays = dailyEntryPairs.map(([, e]) => e).filter((e) => e.status === "present");
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
 * Returns undefined when the month is before the employee's effective first month (no data for that period).
 * Pass employeeCreatedAt/employeeJoiningDate when caller already has them to avoid extra Employee.findById. */
export async function getEmployeeSnapshotForMonth(
  employeeId: string,
  month: string,
  employeeCreatedAt?: Date,
  employeeJoiningDate?: string,
  employeeType?: "Fixed" | "Daily",
  employeeEndingDate?: string
): Promise<MonthlySnapshot | undefined> {
  let firstMonth: string | null = null;
  let lastMonth: string | null = null;
  if (employeeCreatedAt != null || employeeJoiningDate != null) {
    firstMonth = effectiveFirstMonth({ createdAt: employeeCreatedAt, joiningDate: employeeJoiningDate });
    lastMonth = effectiveLastMonth({ endingDate: employeeEndingDate });
  } else {
    const employee = await Employee.findById(employeeId).select("createdAt joiningDate endingDate").lean();
    if (!employee) return undefined;
    firstMonth = effectiveFirstMonth(employee);
    lastMonth = effectiveLastMonth(employee);
  }
  if (firstMonth && month < firstMonth) return undefined;
  if (lastMonth && month > lastMonth) return undefined;

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
  const outstandingAdvance =
    employeeType === "Daily"
      ? await getOutstandingAdvanceThroughMonth(employeeId, month, {
          createdAt: employeeCreatedAt,
          joiningDate: employeeJoiningDate,
        })
      : undefined;
  return {
    payable,
    paid,
    remaining,
    advancePaid,
    ...(outstandingAdvance !== undefined && { outstandingAdvance }),
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

export interface EmployeeTotalsOptions {
  /** Inclusive "YYYY-MM-DD" range. When provided, totals reflect only that period — see the
   *  semantics note on getEmployeeTotals below. */
  startDate?: string;
  endDate?: string;
}

/** Aggregate totalPaid (sum of all payments) and totalDue (sum of remaining per month) for an employee.
 * Includes the current month in totalDue so pending salary for the current month is reflected.
 *
 * Date-range semantics (when options.startDate/endDate are supplied): payroll doesn't have a single
 * "occurred on" date per liability — a month's salary accrues across the whole month. We treat a
 * month's payable amount as "occurring within the range" if that calendar month (YYYY-MM) overlaps
 * the [startDate, endDate] range at all, i.e. the month string falls between startDate's and
 * endDate's month. Payments are attributed to their own `date` field (when it falls within the
 * range), same as vendors/contractors/machines. This mirrors how a real payroll ledger would report
 * "salary liability for period X" — the accrual is monthly, not daily, but everything else in the
 * range filter is date-precise. */
export async function getEmployeeTotals(
  employeeId: string,
  options?: EmployeeTotalsOptions
): Promise<{ totalPaid: number; totalDue: number; totalAdvance: number }> {
  if (!mongoose.Types.ObjectId.isValid(employeeId)) {
    return { totalPaid: 0, totalDue: 0, totalAdvance: 0 };
  }
  const oid = new mongoose.Types.ObjectId(employeeId);
  const startDate = options?.startDate?.trim() || undefined;
  const endDate = options?.endDate?.trim() || undefined;
  const currentMonth = getCurrentMonth();

  if (!startDate && !endDate) {
    const [employee, paidAgg, paymentMonths, attendanceMonths] = await Promise.all([
      Employee.findById(employeeId).select("createdAt joiningDate endingDate").lean(),
      EmployeePayment.aggregate([{ $match: { employeeId: oid } }, { $group: { _id: null, total: { $sum: "$amount" } } }]),
      EmployeePayment.distinct("month", { employeeId: oid }),
      EmployeeAttendance.distinct("month", { employeeId: oid }),
    ]);
    const totalPaid = paidAgg[0]?.total ?? 0;
    const firstMonth = employee ? effectiveFirstMonth(employee) ?? "1970-01" : "1970-01";
    const lastMonth = employee ? effectiveLastMonth(employee) : null;
    // An employee who has left doesn't accrue liability past their ending month.
    const cappedCurrentMonth = lastMonth && lastMonth < currentMonth ? lastMonth : currentMonth;
    const monthsUpToCurrent = monthsFromTo(firstMonth, cappedCurrentMonth);
    const months = [...new Set([...paymentMonths, ...attendanceMonths, ...monthsUpToCurrent])].filter(
      (m) => m >= firstMonth && m <= cappedCurrentMonth
    );
    let totalDue = 0;
    let totalPayable = 0;
    for (const month of months) {
      const payable = await computePayableForMonth(employeeId, month);
      const paid = await getMonthPaid(employeeId, month);
      totalDue += Math.max(0, payable - paid);
      totalPayable += payable;
    }
    // Advance = money handed over beyond everything earned so far. Daily-wage advances are paid
    // ahead of marked attendance, so they show up here until the work catches up with them.
    const totalAdvance = Math.max(0, roundAmount(totalPaid - totalPayable));
    return { totalPaid, totalDue, totalAdvance };
  }

  // Date-ranged: payable is summed over the months overlapping the range (see semantics note
  // above), minus payments dated within the range for those same months. totalPaid (display stat)
  // is every payment dated within the range, regardless of which month it settles.
  const employee = await Employee.findById(employeeId).select("createdAt joiningDate endingDate").lean();
  const firstMonth = employee ? effectiveFirstMonth(employee) ?? "1970-01" : "1970-01";
  const lastMonth = employee ? effectiveLastMonth(employee) : null;
  const rangeStartMonth = startDate ? startDate.slice(0, 7) : firstMonth;
  const rangeEndMonth = endDate ? endDate.slice(0, 7) : currentMonth;
  const loMonth = rangeStartMonth > firstMonth ? rangeStartMonth : firstMonth;
  let hiMonth = rangeEndMonth < currentMonth ? rangeEndMonth : currentMonth;
  if (lastMonth && lastMonth < hiMonth) hiMonth = lastMonth;
  const months = monthsFromTo(loMonth, hiMonth);

  const dateMatch: Record<string, unknown> = {
    ...(startDate && { $gte: startDate }),
    ...(endDate && { $lte: endDate }),
  };
  const paidAgg = await EmployeePayment.aggregate([
    { $match: { employeeId: oid, date: dateMatch } },
    { $group: { _id: null, total: { $sum: "$amount" } } },
  ]);
  const totalPaid = paidAgg[0]?.total ?? 0;

  let totalDue = 0;
  let totalPayable = 0;
  for (const month of months) {
    const payable = await computePayableForMonth(employeeId, month);
    // Payments toward that month's due, restricted to the date range.
    const monthPaid = await EmployeePayment.aggregate([
      { $match: { employeeId: oid, month, date: dateMatch } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]).then((r) => r[0]?.total ?? 0);
    totalDue += Math.max(0, payable - monthPaid);
    totalPayable += payable;
  }
  const totalAdvance = Math.max(0, roundAmount(totalPaid - totalPayable));
  return { totalPaid, totalDue, totalAdvance };
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

/** Month (YYYY-MM) strictly before the given month. */
function prevMonth(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(year, monthNumber - 2, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Daily/wage employees only: advances are given ahead of any specific month's payable, so track
 * how much advance given BEFORE month M has NOT yet been "worked off" by payable earned in prior
 * months. carriedIn(M) = max(0, sum(Advance payments dated before M) - sum(payable for every
 * month before M)). Deliberately excludes advances dated IN month M itself — those are already
 * reflected in that month's own `paid` total (which sums every payment type for the month), so
 * the salary sheet combines this carried-in figure with `paid` rather than double counting.
 */
export async function getOutstandingAdvanceThroughMonth(
  employeeId: string,
  month: string,
  employee: { joiningDate?: string; createdAt?: Date }
): Promise<number> {
  const monthStart = `${month}-01`;
  const advanceAgg = await EmployeePayment.aggregate([
    {
      $match: {
        employeeId: new mongoose.Types.ObjectId(employeeId),
        type: "Advance",
        date: { $lt: monthStart },
      },
    },
    { $group: { _id: null, total: { $sum: "$amount" } } },
  ]);
  const advanceTotal = advanceAgg[0]?.total ?? 0;

  const firstMonth = effectiveFirstMonth(employee);
  if (!firstMonth || firstMonth >= month) {
    return Math.max(0, roundAmount(advanceTotal));
  }
  const priorMonths = monthsFromTo(firstMonth, prevMonth(month));
  let payableBefore = 0;
  for (const m of priorMonths) {
    payableBefore += await computePayableForMonth(employeeId, m);
  }
  return Math.max(0, roundAmount(advanceTotal - payableBefore));
}

/** Validation: can we add this payment? Amount > 0 and currentPaid + amount <= payable.
 * Daily (wage) employees' Advance-type payments skip this entirely — they aren't tied to a
 * specific month's payable, since advances are typically given ahead of marked attendance. */
async function validateAddPayment(
  employeeId: string,
  month: string,
  amount: number,
  globalAllowedLeaves: number,
  employeeType: "Fixed" | "Daily",
  paymentType: "Advance" | "Salary" | "Wage"
): Promise<void> {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Amount must be greater than zero.");
  }
  if (employeeType === "Daily" && paymentType === "Advance") {
    return;
  }
  const payable = await computePayableForMonth(employeeId, month, globalAllowedLeaves);
  if (payable <= 0) {
    throw new Error(
      "No dues for this month. The employee did not exist or has no payable amount for the selected month."
    );
  }
  const currentPaid = await getMonthPaid(employeeId, month);
  if (currentPaid + amount > payable) {
    const maxAllowed = Math.max(0, Math.round((payable - currentPaid) * 100) / 100);
    throw new Error(
      `Total paid for this month would exceed payable (${payable.toLocaleString()}). Maximum allowed: ${maxAllowed.toLocaleString()}.`
    );
  }
}

/** Validation: can we apply this edit? Same logic as frontend canEditPayment.
 * Daily (wage) employees' Advance-type payments skip this entirely (see validateAddPayment). */
async function validateEditPayment(
  payment: IEmployeePayment,
  employeeId: string,
  newAmount: number,
  newMonth: string,
  globalAllowedLeaves: number,
  employeeType: "Fixed" | "Daily",
  newType: "Advance" | "Salary" | "Wage"
): Promise<void> {
  if (!Number.isFinite(newAmount) || newAmount <= 0) {
    throw new Error("Amount must be greater than zero.");
  }
  if (employeeType === "Daily" && newType === "Advance") {
    return;
  }
  const oldMonth = payment.month;
  const oldAmount = payment.amount;

  if (newMonth === oldMonth) {
    const payable = await computePayableForMonth(employeeId, oldMonth, globalAllowedLeaves);
    const currentPaid = await getMonthPaid(employeeId, oldMonth);
    const paidAfterEdit = currentPaid - oldAmount + newAmount;
    if (paidAfterEdit > payable) {
      const maxAllowed = Math.max(0, Math.round((payable - (currentPaid - oldAmount)) * 100) / 100);
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
    const maxAllowed = Math.max(0, Math.round((payableNew - paidNew) * 100) / 100);
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
  /** Daily (wage) employees only: cumulative advance not yet worked off through this month. */
  outstandingAdvance?: number;
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
    if (!(await isProjectAssignedToUser(actor.userId, employee.projectId.toString()))) {
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
  const employee = await ensureEmployeeAccess(actor, employeeId);

  if (!input.month?.trim() || !input.date?.trim()) throw new Error("Month and date are required");
  if (!["Advance", "Salary", "Wage"].includes(input.type)) throw new Error("Invalid payment type");
  if (!["Cash", "Bank", "Online"].includes(input.paymentMethod)) throw new Error("Invalid payment method");

  await validateAddPayment(
    employeeId,
    input.month,
    input.amount,
    GLOBAL_ALLOWED_LEAVES_DEFAULT,
    employee.type,
    input.type
  );

  const payment = await EmployeePayment.create({
    employeeId: new mongoose.Types.ObjectId(employeeId),
    month: input.month.trim(),
    date: input.date.trim(),
    amount: input.amount,
    type: input.type,
    paymentMethod: input.paymentMethod,
    remarks: input.remarks?.trim(),
  });

  // Machinery Employee salary is paid from the assigned Company Owned machine's balance.
  // Keep the two records linked so removing the salary also reverses the machine expense.
  if (employee.category === "Machinery" && employee.machineId) {
    const machinePayment = await MachinePayment.create({
      machineId: employee.machineId,
      date: payment.date,
      amount: payment.amount,
      paymentMethod: payment.paymentMethod,
      referenceId: `Machinery employee ${payment.type.toLowerCase()} — ${employee.name}`,
    });
    payment.machinePaymentId = machinePayment._id;
    await payment.save();
    await rebuildMachinePaymentAllocations(employee.machineId.toString());
  }

  const employeeName = await Employee.findById(employeeId).select("name").lean();
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
    projectId: employee.projectId?.toString(),
    projectName: await getProjectName(employee.projectId?.toString()),
    description: `Payment recorded: ${employeeName?.name ?? "Employee"} - ${payment.type} ${payment.amount.toLocaleString()} (${payment.month})`,
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

  const employee = await ensureEmployeeAccess(actor, payment.employeeId.toString());

  const newAmount = input.amount ?? payment.amount;
  const newMonth = (input.month ?? payment.month).trim();
  const newType = input.type ?? payment.type;

  await validateEditPayment(
    payment,
    payment.employeeId.toString(),
    newAmount,
    newMonth,
    GLOBAL_ALLOWED_LEAVES_DEFAULT,
    employee.type,
    newType
  );

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
    projectId: employee.projectId?.toString(),
    projectName: await getProjectName(employee.projectId?.toString()),
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

  const employee = await ensureEmployeeAccess(actor, payment.employeeId.toString());

  await EmployeePayment.findByIdAndDelete(paymentId);
  if (payment.machinePaymentId) {
    await MachinePayment.findByIdAndDelete(payment.machinePaymentId);
    if (employee.machineId) await rebuildMachinePaymentAllocations(employee.machineId.toString());
  }

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
    projectId: employee.projectId?.toString(),
    projectName: await getProjectName(employee.projectId?.toString()),
    description: `Deleted payment: ${payment.amount} (${payment.month})`,
    oldValue: { amount: payment.amount, month: payment.month },
  });
}

export interface GetEmployeeLedgerOptions {
  month?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  pageSize?: number;
}

const DEFAULT_PAGE_SIZE = 12;

export interface GetEmployeeLedgerResult {
  payments: EmployeePaymentPayload[];
  rows: EmployeeLedgerRow[];
  previousBalance: number;
  total: number;
  snapshot?: MonthlySnapshot;
}

export interface EmployeeLedgerRow {
  type: "payable" | "payment";
  id: string;
  date: string;
  month: string;
  amount: number;
  remarks?: string;
  paymentMethod?: string;
  paymentType?: string;
  runningTotal: number;
}

export async function getEmployeeLedger(
  actor: { userId: string; role: string },
  employeeId: string,
  options?: GetEmployeeLedgerOptions
): Promise<GetEmployeeLedgerResult> {
  if (!mongoose.Types.ObjectId.isValid(employeeId)) {
    return { payments: [], rows: [], previousBalance: 0, total: 0 };
  }

  await ensureEmployeeAccess(actor, employeeId);

  const page = Math.max(1, options?.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, options?.pageSize ?? DEFAULT_PAGE_SIZE));
  const baseMatch = { employeeId: new mongoose.Types.ObjectId(employeeId) };

  // Payments remain available for existing consumers; the rows below are the
  // complete economics ledger, including monthly payable salary/wage entries.
  const [total, paymentDocs, employee] = await Promise.all([
    EmployeePayment.countDocuments(baseMatch),
    EmployeePayment.find(baseMatch)
      .sort({ date: 1, month: 1, _id: 1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    Employee.findById(employeeId).lean(),
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
    const outstandingAdvance =
      employee?.type === "Daily"
        ? await getOutstandingAdvanceThroughMonth(employeeId, month, {
            createdAt: employee.createdAt,
            joiningDate: employee.joiningDate,
          })
        : undefined;
    snapshot = {
      payable,
      paid,
      remaining,
      advancePaid,
      ...(outstandingAdvance !== undefined && { outstandingAdvance }),
      paymentStatus: paymentStatus(payable, paid, remaining, settlementDate, monthEnd),
    };
  }

  const allPaymentDocs = await EmployeePayment.find(baseMatch).sort({ date: 1, _id: 1 }).lean();
  const firstMonth = employee ? effectiveFirstMonth(employee) : null;
  const lastMonth = employee ? effectiveLastMonth(employee) : null;
  const currentMonth = monthKeyPKT();
  // An employee who has left doesn't accrue payable rows past their ending month.
  const cappedCurrentMonth = lastMonth && lastMonth < currentMonth ? lastMonth : currentMonth;
  const payableRows: Omit<EmployeeLedgerRow, "runningTotal">[] = [];
  if (firstMonth) {
    for (let cursor = firstMonth; cursor <= cappedCurrentMonth; cursor = nextMonth(cursor)) {
      const payable = await computePayableForMonth(employeeId, cursor);
      if (payable > 0) {
        payableRows.push({ type: "payable", id: `payable-${cursor}`, date: monthEndDate(cursor), month: cursor, amount: payable, remarks: employee?.type === "Fixed" ? "Monthly salary payable" : "Monthly wage payable" });
      }
    }
  }
  const allRows: Omit<EmployeeLedgerRow, "runningTotal">[] = [
    ...payableRows,
    ...allPaymentDocs.map((payment) => ({ type: "payment" as const, id: payment._id.toString(), date: payment.date, month: payment.month, amount: payment.amount, remarks: payment.remarks, paymentMethod: payment.paymentMethod, paymentType: payment.type })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  // Every payment type — including Advance — settles against the running balance the same way:
  // payable adds to what's owed, any payment (Advance, Salary, or Wage) subtracts from it. An
  // outstanding, not-yet-worked-off advance for daily wage employees is tracked separately (see
  // getOutstandingAdvanceThroughMonth) for the salary sheet net figure, not in this running balance.
  let balance = 0;
  let previousBalance = 0;
  const rows: EmployeeLedgerRow[] = [];
  for (const row of allRows) {
    if (row.type === "payable") {
      balance += row.amount;
    } else {
      balance -= row.amount;
    }
    if (options?.startDate && row.date < options.startDate) {
      previousBalance = balance;
      continue;
    }
    if (options?.endDate && row.date > options.endDate) continue;
    rows.push({ ...row, runningTotal: balance });
  }

  return { payments, rows, previousBalance, total: rows.length, snapshot };
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
  const employee = await ensureEmployeeAccess(actor, employeeId);
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
  const outstandingAdvance =
    employee.type === "Daily"
      ? await getOutstandingAdvanceThroughMonth(employeeId, m, {
          createdAt: employee.createdAt,
          joiningDate: employee.joiningDate,
        })
      : undefined;
  const snapshot: MonthlySnapshot = {
    payable,
    paid,
    remaining,
    advancePaid,
    ...(outstandingAdvance !== undefined && { outstandingAdvance }),
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
