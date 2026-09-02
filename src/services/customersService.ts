/**
 * Customers API service - CRUD for project-scoped customer management
 */

import { api } from "./api";

export interface ApiCustomer {
  id: string;
  projectId: string;
  name: string;
  phone: string;
  description: string;
  totalSold: number;
  totalReceived: number;
  /** Signed: positive = customer prepaid (credit); negative = customer owes us (receivable). */
  balance: number;
}

export interface CreateCustomerInput {
  projectId: string;
  name: string;
  phone?: string;
  description?: string;
}

export interface UpdateCustomerInput {
  name?: string;
  phone?: string;
  description?: string;
}

/** projectId: filter by project. Omit for all customers (Admin/Super Admin only).
 *  startDate/endDate: optional inclusive date range — when set, totals reflect that period. */
export async function listCustomers(
  projectId?: string | null,
  startDate?: string | null,
  endDate?: string | null
): Promise<ApiCustomer[]> {
  const params = new URLSearchParams();
  if (projectId) params.set("projectId", projectId);
  if (startDate) params.set("startDate", startDate);
  if (endDate) params.set("endDate", endDate);
  const q = params.toString();
  return api<ApiCustomer[]>(`/api/customers${q ? `?${q}` : ""}`);
}

export async function getCustomer(id: string): Promise<ApiCustomer> {
  return api<ApiCustomer>(`/api/customers/${id}`);
}

export async function createCustomer(input: CreateCustomerInput): Promise<ApiCustomer> {
  return api<ApiCustomer>("/api/customers", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateCustomer(id: string, input: UpdateCustomerInput): Promise<ApiCustomer> {
  return api<ApiCustomer>(`/api/customers/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteCustomer(id: string): Promise<void> {
  return api<void>(`/api/customers/${id}`, {
    method: "DELETE",
  });
}
