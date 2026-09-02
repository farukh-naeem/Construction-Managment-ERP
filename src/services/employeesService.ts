/**
 * Employees API service - CRUD and list from backend (MongoDB).
 */

import { api } from "./api";

export type ApiEmployeeType = "Fixed" | "Daily";
export type ApiEmployeeCategory = "Regular" | "Machinery";

export interface ApiEmployee {
  id: string;
  projectId: string;
  project?: string;
  name: string;
  role: string;
  type: ApiEmployeeType;
  monthlySalary?: number;
  dailyRate?: number;
  phone: string;
  category: ApiEmployeeCategory;
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
  type: ApiEmployeeType;
  monthlySalary?: number;
  dailyRate?: number;
  phone?: string;
  joiningDate?: string;
  endingDate?: string;
  category?: ApiEmployeeCategory;
  machineId?: string;
}

export interface UpdateEmployeeInput {
  name?: string;
  role?: string;
  type?: ApiEmployeeType;
  monthlySalary?: number;
  dailyRate?: number;
  phone?: string;
  joiningDate?: string;
  endingDate?: string;
}

export interface AttendanceSnapshotFixed {
  type: "Fixed";
  present: number;
  absent: number;
  paidLeave: number;
  unpaidLeave: number;
}

export interface AttendanceSnapshotDaily {
  type: "Daily";
  workedDays: number;
  overtimeHours: number;
}

export type AttendanceSnapshot = AttendanceSnapshotFixed | AttendanceSnapshotDaily;

export interface ApiEmployeeWithSnapshot extends ApiEmployee {
  snapshot?: {
    payable: number;
    paid: number;
    remaining: number;
    advancePaid?: number;
    /** Daily (wage) employees only: cumulative advance not yet worked off through this month. */
    outstandingAdvance?: number;
    paymentStatus: "Paid" | "Partial" | "Due" | "Late";
    attendance?: AttendanceSnapshot;
  };
}

/** projectId: filter by project. month: optional, for per-month snapshot in list.
 *  startDate/endDate: optional inclusive date range — when both set, totalPaid/totalDue reflect that period. */
export async function listEmployees(
  projectId?: string | null,
  month?: string | null,
  category?: ApiEmployeeCategory,
  startDate?: string | null,
  endDate?: string | null
): Promise<ApiEmployeeWithSnapshot[]> {
  const params = new URLSearchParams();
  if (projectId) params.set("projectId", projectId);
  if (month) params.set("month", month);
  if (category) params.set("category", category);
  if (startDate) params.set("startDate", startDate);
  if (endDate) params.set("endDate", endDate);
  const q = params.toString();
  return api<ApiEmployeeWithSnapshot[]>(`/api/employees${q ? `?${q}` : ""}`);
}

export async function getEmployee(id: string): Promise<ApiEmployee> {
  return api<ApiEmployee>(`/api/employees/${id}`);
}

export async function createEmployee(input: CreateEmployeeInput): Promise<ApiEmployee> {
  return api<ApiEmployee>("/api/employees", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateEmployee(id: string, input: UpdateEmployeeInput): Promise<ApiEmployee> {
  return api<ApiEmployee>(`/api/employees/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteEmployee(id: string): Promise<void> {
  return api<void>(`/api/employees/${id}`, {
    method: "DELETE",
  });
}
