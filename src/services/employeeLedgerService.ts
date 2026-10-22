/**
 * Employee ledger API - payments and attendance from backend.
 */

import { api } from "./api";

export interface ApiEmployeePayment {
  id: string;
  employeeId: string;
  month: string;
  date: string;
  amount: number;
  type: "Advance" | "Salary" | "Wage";
  paymentMethod: "Cash" | "Bank" | "Online";
  remarks?: string;
}

export interface ApiMonthlySnapshot {
  payable: number;
  monthlySalary?: number;
  paid: number;
  remaining: number;
  /** Sum of Advance payments for the month; omit on older API responses */
  advancePaid?: number;
  /** Daily (wage) employees only: cumulative advance not yet worked off through this month. */
  outstandingAdvance?: number;
  paymentStatus: "Paid" | "Partial" | "Due" | "Late";
}

export interface ApiEmployeeLedger {
  payments: ApiEmployeePayment[];
  rows: ApiEmployeeLedgerRow[];
  previousBalance: number;
  total: number;
  snapshot?: ApiMonthlySnapshot;
}

export interface ApiEmployeeLedgerRow {
  type: "payable" | "payment" | "salary_change" | "previous";
  id: string;
  date: string;
  month: string;
  amount: number;
  remarks?: string;
  paymentMethod?: string;
  paymentType?: string;
  previousSalary?: number;
  newSalary?: number;
  runningTotal: number;
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

export interface ApiAttendance {
  month: string;
  fixedEntries: { day: number; status: string }[];
  dailyEntries: { day: number; hoursWorked: number; overtimeHours: number; status: string; notes?: string }[];
}

export interface PutAttendanceInput {
  month: string;
  fixedEntries?: { day: number; status: string }[];
  dailyEntries?: { day: number; hoursWorked: number; overtimeHours: number; status: string; notes?: string }[];
}

export async function getEmployeeLedger(
  employeeId: string,
  options?: { month?: string; startDate?: string; endDate?: string; page?: number; pageSize?: number }
): Promise<ApiEmployeeLedger> {
  const params = new URLSearchParams();
  if (options?.month) params.set("month", options.month);
  if (options?.startDate) params.set("startDate", options.startDate);
  if (options?.endDate) params.set("endDate", options.endDate);
  if (options?.page != null) params.set("page", String(options.page));
  if (options?.pageSize != null) params.set("pageSize", String(options.pageSize));
  const q = params.toString();
  return api<ApiEmployeeLedger>(`/api/employees/${employeeId}/ledger${q ? `?${q}` : ""}`);
}

export interface ApiLedgerSnapshotResponse {
  snapshot: ApiMonthlySnapshot | null;
}

/** Fetch only the monthly snapshot (payable, paid, remaining). Use when month changes so the payments list is not refetched. */
export async function getEmployeeLedgerSnapshot(
  employeeId: string,
  month: string
): Promise<ApiLedgerSnapshotResponse> {
  const params = new URLSearchParams({ month });
  return api<ApiLedgerSnapshotResponse>(`/api/employees/${employeeId}/ledger/snapshot?${params}`);
}

export async function createEmployeePayment(
  employeeId: string,
  input: CreateEmployeePaymentInput
): Promise<ApiEmployeePayment> {
  return api<ApiEmployeePayment>(`/api/employees/${employeeId}/payments`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateEmployeePayment(
  employeeId: string,
  paymentId: string,
  input: UpdateEmployeePaymentInput
): Promise<ApiEmployeePayment> {
  return api<ApiEmployeePayment>(`/api/employees/${employeeId}/payments/${paymentId}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function deleteEmployeePayment(
  employeeId: string,
  paymentId: string
): Promise<void> {
  return api<void>(`/api/employees/${employeeId}/payments/${paymentId}`, {
    method: "DELETE",
  });
}

export async function getAttendance(
  employeeId: string,
  month: string
): Promise<ApiAttendance> {
  return api<ApiAttendance>(
    `/api/employees/${employeeId}/attendance?${new URLSearchParams({ month })}`
  );
}

export async function putAttendance(
  employeeId: string,
  input: PutAttendanceInput
): Promise<ApiAttendance> {
  return api<ApiAttendance>(`/api/employees/${employeeId}/attendance`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}
