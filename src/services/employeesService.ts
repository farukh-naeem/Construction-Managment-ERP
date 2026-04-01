/**
 * Employees API service - CRUD and list from backend (MongoDB).
 */

import { api } from "./api";

export type ApiEmployeeType = "Fixed" | "Daily";

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
  totalPaid?: number;
  totalDue?: number;
  createdAt?: string;
}

export interface CreateEmployeeInput {
  projectId: string;
  name: string;
  role: string;
  type: ApiEmployeeType;
  monthlySalary?: number;
  dailyRate?: number;
  phone?: string;
}

export interface UpdateEmployeeInput {
  name?: string;
  role?: string;
  type?: ApiEmployeeType;
  monthlySalary?: number;
  dailyRate?: number;
  phone?: string;
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
    paymentStatus: "Paid" | "Partial" | "Due" | "Late";
    attendance?: AttendanceSnapshot;
  };
}

/** projectId: filter by project. month: optional, for per-month snapshot in list. */
export async function listEmployees(
  projectId?: string | null,
  month?: string | null
): Promise<ApiEmployeeWithSnapshot[]> {
  const params = new URLSearchParams();
  if (projectId) params.set("projectId", projectId);
  if (month) params.set("month", month);
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
