import type { Employee } from "@/lib/mock-data";

export const EMPLOYEE_LEDGER_STORAGE_KEY = "construction-crm.employee-ledger.v1";
export const GLOBAL_ALLOWED_LEAVES_DEFAULT = 4;

export type PaymentStatus = "Paid" | "Partial" | "Due" | "Late";
export type PaymentMethod = "Cash" | "Bank" | "Online";
export type PaymentType = "Advance" | "Salary" | "Wage";
export type FixedDayStatus = "present" | "absent" | "paid_leave" | "unpaid_leave" | "leave";
export type DailyDayStatus = "present" | "absent" | "leave";

export interface EmployeePaymentRecord {
  id: string;
  employeeId: string;
  month: string;
  date: string;
  amount: number;
  type: PaymentType;
  method: PaymentMethod;
  remarks?: string;
}

export interface DailyAttendanceDay {
  status: DailyDayStatus;
  hoursWorked: number;
  overtimeHours: number;
  notes?: string;
}

export interface EmployeeLedgerStore {
  globalAllowedLeaves: number;
  fixedAttendanceByMonth: Record<string, Record<number, FixedDayStatus>>;
  dailyAttendanceByMonth: Record<string, Record<number, DailyAttendanceDay>>;
  paymentRecords: EmployeePaymentRecord[];
}

export interface EmployeeMonthlySnapshot {
  payable: number;
  paid: number;
  remaining: number;
  paymentStatus: PaymentStatus;
  absents: number;
  leaves: number;
  paidLeaves: number;
  unpaidLeaves: number;
  unpaidLeaveDays: Set<number>;
  workedDays: number;
  overtimeHours: number;
  advances: number;
  salaryOrWagePaid: number;
  baseSalary: number;
  unpaidLeaveDeduction: number;
  netPayable: number;
  dailyWageComponent: number;
  overtimeRate: number;
  overtimePay: number;
}

/** Returns YYYY-MM using local timezone. Use for "current month" defaults. */
export function getLocalMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function getMonthKey(employeeId: string, month: string) {
  return `${employeeId}:${month}`;
}

export function getDaysInMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(year, monthNumber, 0).getDate();
}

export function monthDate(month: string, day: number) {
  return `${month}-${String(day).padStart(2, "0")}`;
}

export function shiftMonth(month: string, delta: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(year, monthNumber - 1 + delta, 1);
  const nextYear = date.getFullYear();
  const nextMonth = String(date.getMonth() + 1).padStart(2, "0");
  return `${nextYear}-${nextMonth}`;
}

export function monthLabel(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(
    new Date(year, monthNumber - 1, 1)
  );
}

/** Compact label for salary sheets, e.g. Sep-2025 */
export function salarySheetMonthLabel(monthKey: string) {
  const [year, monthNumber] = monthKey.split("-").map(Number);
  const short = new Intl.DateTimeFormat("en-US", { month: "short" }).format(
    new Date(year, monthNumber - 1, 1)
  );
  return `${short}-${year}`;
}

export function buildMonthOptions(anchorMonth: string, before = 12, after = 12) {
  const values: string[] = [];
  for (let offset = before; offset >= 1; offset -= 1) {
    values.push(shiftMonth(anchorMonth, -offset));
  }
  values.push(anchorMonth);
  for (let offset = 1; offset <= after; offset += 1) {
    values.push(shiftMonth(anchorMonth, offset));
  }
  return values;
}

/** Returns YYYY-MM from employee createdAt. For months before this, show NO DATA. */
export function getFirstMonth(createdAt: string | undefined): string | undefined {
  if (!createdAt) return undefined;
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return undefined;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** Month options up to current month only (no future). Use for viewing data. */
export function buildMonthOptionsUpToCurrent(beforeMonths = 12): string[] {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const values: string[] = [];
  for (let offset = beforeMonths; offset >= 0; offset -= 1) {
    values.push(shiftMonth(currentMonth, -offset));
  }
  return values;
}

/** Month options for advance payment: next month + following months. */
export function buildAdvanceMonthOptions(aheadMonths = 6): string[] {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const values: string[] = [];
  for (let offset = 1; offset <= aheadMonths; offset += 1) {
    values.push(shiftMonth(currentMonth, offset));
  }
  return values;
}

function sumAmount(records: EmployeePaymentRecord[]) {
  return records.reduce((total, record) => total + record.amount, 0);
}

function roundAmount(value: number) {
  return Math.round(value);
}

function toDateValue(date: string) {
  return new Date(`${date}T00:00:00`).getTime();
}

function getMonthEndDate(month: string) {
  return monthDate(month, getDaysInMonth(month));
}

function paymentStatusForMonth(
  payable: number,
  paid: number,
  remaining: number,
  settlementDate: string | null,
  monthEndDate: string
): PaymentStatus {
  if (payable <= 0) return "Paid";
  if (remaining <= 0) {
    if (settlementDate && settlementDate > monthEndDate) return "Late";
    return "Paid";
  }
  if (paid > 0) return "Partial";
  return "Due";
}

export function computeMonthlySnapshot(
  employee: Employee,
  month: string,
  store: EmployeeLedgerStore
): EmployeeMonthlySnapshot {
  const monthKey = getMonthKey(employee.id, month);
  const monthPayments = store.paymentRecords
    .filter((payment) => payment.employeeId === employee.id && payment.month === month)
    .sort((a, b) => toDateValue(a.date) - toDateValue(b.date));

  const advances = sumAmount(monthPayments.filter((payment) => payment.type === "Advance"));
  const monthEndDate = getMonthEndDate(month);

  if (employee.type === "Fixed") {
    const fixedAttendance = store.fixedAttendanceByMonth[monthKey] ?? {};
    const baseSalary = employee.monthlySalary ?? 0;
    const absents = Object.values(fixedAttendance).filter((status) => status === "absent").length;
    const explicitPaidLeaveDays = Object.entries(fixedAttendance)
      .filter(([, status]) => status === "paid_leave")
      .map(([day]) => Number(day));
    const legacyLeaveDays = Object.entries(fixedAttendance)
      .filter(([, status]) => status === "leave")
      .map(([day]) => Number(day));
    const explicitUnpaidLeaveDays = Object.entries(fixedAttendance)
      .filter(([, status]) => status === "unpaid_leave")
      .map(([day]) => Number(day));

    const paidLeaves = explicitPaidLeaveDays.length + legacyLeaveDays.length;
    const unpaidLeaves = explicitUnpaidLeaveDays.length;
    const leaves = paidLeaves + unpaidLeaves;
    const unpaidLeaveDays = new Set<number>(explicitUnpaidLeaveDays);

    const unpaidLeaveDeduction = roundAmount((baseSalary / getDaysInMonth(month)) * unpaidLeaves);
    const payable = Math.max(baseSalary - unpaidLeaveDeduction, 0);
    const salaryPaid = sumAmount(monthPayments.filter((payment) => payment.type === "Salary"));
    const paid = salaryPaid + advances;
    const remaining = Math.max(payable - paid, 0);
    const nonAdvancePayments = monthPayments.filter((payment) => payment.type !== "Advance");
    const settlementDate = nonAdvancePayments.length
      ? nonAdvancePayments[nonAdvancePayments.length - 1].date
      : null;

    return {
      payable,
      paid,
      remaining,
      paymentStatus: paymentStatusForMonth(payable, paid, remaining, settlementDate, monthEndDate),
      absents,
      leaves,
      paidLeaves,
      unpaidLeaves,
      unpaidLeaveDays,
      workedDays: 0,
      overtimeHours: 0,
      advances,
      salaryOrWagePaid: salaryPaid,
      baseSalary,
      unpaidLeaveDeduction,
      netPayable: Math.max(payable - advances, 0),
      dailyWageComponent: 0,
      overtimeRate: 0,
      overtimePay: 0,
    };
  }

  const dailyAttendance = store.dailyAttendanceByMonth[monthKey] ?? {};
  const presentDays = Object.values(dailyAttendance).filter((entry) => entry.status === "present");
  const overtimeHours = presentDays.reduce((total, entry) => total + Math.max(entry.overtimeHours, 0), 0);
  const workedDays = presentDays.reduce(
    (total, entry) => total + Math.min(Math.max(entry.hoursWorked, 0), 8) / 8,
    0
  );

  const dailyRate = employee.dailyRate ?? 0;
  const overtimeRate = dailyRate / 8;
  const dailyWageComponent = roundAmount(workedDays * dailyRate);
  const overtimePay = roundAmount(overtimeHours * overtimeRate);
  const payable = dailyWageComponent + overtimePay;
  const wagePaid = sumAmount(monthPayments.filter((payment) => payment.type === "Wage"));
  const paid = wagePaid + advances;
  const remaining = Math.max(payable - paid, 0);
  const nonAdvancePayments = monthPayments.filter((payment) => payment.type !== "Advance");
  const settlementDate = nonAdvancePayments.length
    ? nonAdvancePayments[nonAdvancePayments.length - 1].date
    : null;

  return {
    payable,
    paid,
    remaining,
    paymentStatus: paymentStatusForMonth(payable, paid, remaining, settlementDate, monthEndDate),
    absents: Object.values(dailyAttendance).filter((entry) => entry.status === "absent").length,
    leaves: Object.values(dailyAttendance).filter((entry) => entry.status === "leave").length,
    paidLeaves: 0,
    unpaidLeaves: 0,
    unpaidLeaveDays: new Set<number>(),
    workedDays,
    overtimeHours,
    advances,
    salaryOrWagePaid: wagePaid,
    baseSalary: 0,
    unpaidLeaveDeduction: 0,
    netPayable: Math.max(payable - advances, 0),
    dailyWageComponent,
    overtimeRate,
    overtimePay,
  };
}

function deepCloneDefaultStore(): EmployeeLedgerStore {
  const month = getLocalMonthKey();
  return {
    globalAllowedLeaves: GLOBAL_ALLOWED_LEAVES_DEFAULT,
    fixedAttendanceByMonth: {
      [`E001:${month}`]: { 6: "paid_leave", 9: "paid_leave", 12: "unpaid_leave", 18: "paid_leave", 20: "absent" },
      [`E002:${month}`]: { 11: "paid_leave", 22: "absent" },
      [`E005:${month}`]: { 5: "paid_leave", 12: "paid_leave", 19: "paid_leave", 25: "paid_leave" },
    },
    dailyAttendanceByMonth: {
      [`E003:${month}`]: {
        1: { status: "present", hoursWorked: 8, overtimeHours: 0, notes: "Foundation" },
        2: { status: "present", hoursWorked: 8, overtimeHours: 2, notes: "Column pour" },
        3: { status: "absent", hoursWorked: 0, overtimeHours: 0, notes: "Rain" },
        4: { status: "present", hoursWorked: 8, overtimeHours: 1, notes: "Overtime concrete" },
      },
      [`E004:${month}`]: {
        2: { status: "present", hoursWorked: 8, overtimeHours: 0, notes: "Site cleanup" },
        3: { status: "present", hoursWorked: 8, overtimeHours: 0, notes: "Material movement" },
      },
    },
    paymentRecords: [
      {
        id: "EP-E001-1",
        employeeId: "E001",
        month,
        date: monthDate(month, 10),
        amount: 20000,
        type: "Advance",
        method: "Cash",
        remarks: "Advance salary",
      },
      {
        id: "EP-E001-2",
        employeeId: "E001",
        month,
        date: monthDate(month, 28),
        amount: 22000,
        type: "Salary",
        method: "Bank",
        remarks: "Month-end partial",
      },
      {
        id: "EP-E002-1",
        employeeId: "E002",
        month,
        date: monthDate(month, 3),
        amount: 38000,
        type: "Salary",
        method: "Bank",
        remarks: "On-time salary",
      },
      {
        id: "EP-E003-1",
        employeeId: "E003",
        month,
        date: monthDate(month, 25),
        amount: 9000,
        type: "Wage",
        method: "Cash",
        remarks: "Partial wage",
      },
    ],
  };
}

export function loadEmployeeLedgerStore(): EmployeeLedgerStore {
  if (typeof window === "undefined") return deepCloneDefaultStore();

  try {
    const raw = window.localStorage.getItem(EMPLOYEE_LEDGER_STORAGE_KEY);
    if (!raw) {
      const defaults = deepCloneDefaultStore();
      window.localStorage.setItem(EMPLOYEE_LEDGER_STORAGE_KEY, JSON.stringify(defaults));
      return defaults;
    }
    const parsed = JSON.parse(raw) as EmployeeLedgerStore;
    return {
      globalAllowedLeaves:
        typeof parsed.globalAllowedLeaves === "number" ? parsed.globalAllowedLeaves : GLOBAL_ALLOWED_LEAVES_DEFAULT,
      fixedAttendanceByMonth: parsed.fixedAttendanceByMonth ?? {},
      dailyAttendanceByMonth: parsed.dailyAttendanceByMonth ?? {},
      paymentRecords: parsed.paymentRecords ?? [],
    };
  } catch {
    const defaults = deepCloneDefaultStore();
    if (typeof window !== "undefined") {
      window.localStorage.setItem(EMPLOYEE_LEDGER_STORAGE_KEY, JSON.stringify(defaults));
    }
    return defaults;
  }
}

export function saveEmployeeLedgerStore(store: EmployeeLedgerStore) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(EMPLOYEE_LEDGER_STORAGE_KEY, JSON.stringify(store));
}
