/**
 * Expenses API service - CRUD for expense management (project-scoped)
 */

import { api } from "./api";

export type PaymentMode = "Cash" | "Bank" | "Online";

export interface ApiExpense {
  id: string;
  projectId: string;
  date: string;
  description: string;
  category: string;
  paymentMode: PaymentMode;
  amount: number;
}

export interface ListExpensesParams {
  projectId?: string | null;
  search?: string;
  category?: string;
  page?: number;
  pageSize?: number;
  startDate?: string;
  endDate?: string;
}

export interface ListExpensesResult {
  expenses: ApiExpense[];
  total: number;
  totalAmount: number;
  previousTotal?: number;
}

export interface CreateExpenseInput {
  projectId: string;
  date: string;
  description: string;
  category: string;
  paymentMode: PaymentMode;
  amount: number;
}

export interface UpdateExpenseInput {
  date?: string;
  description?: string;
  category?: string;
  paymentMode?: PaymentMode;
  amount?: number;
}

export async function listExpenses(params: ListExpensesParams = {}): Promise<ListExpensesResult> {
  const searchParams = new URLSearchParams();
  if (params.projectId) searchParams.set("projectId", params.projectId);
  if (params.search?.trim()) searchParams.set("search", params.search.trim());
  if (params.category && params.category !== "all") searchParams.set("category", params.category);
  if (params.page != null) searchParams.set("page", String(params.page));
  if (params.pageSize != null) searchParams.set("pageSize", String(params.pageSize));
  if (params.startDate) searchParams.set("startDate", params.startDate);
  if (params.endDate) searchParams.set("endDate", params.endDate);
  const query = searchParams.toString();
  const url = query ? `/api/expenses?${query}` : "/api/expenses";
  return api<ListExpensesResult>(url);
}

export async function listExpenseCategories(projectId?: string | null): Promise<string[]> {
  const url = projectId
    ? `/api/expenses/categories?${new URLSearchParams({ projectId })}`
    : "/api/expenses/categories";
  return api<string[]>(url);
}

export async function getExpense(id: string): Promise<ApiExpense> {
  return api<ApiExpense>(`/api/expenses/${id}`);
}

export async function createExpense(input: CreateExpenseInput): Promise<ApiExpense> {
  return api<ApiExpense>("/api/expenses", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateExpense(id: string, input: UpdateExpenseInput): Promise<ApiExpense> {
  return api<ApiExpense>(`/api/expenses/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteExpense(id: string): Promise<void> {
  return api<void>(`/api/expenses/${id}`, {
    method: "DELETE",
  });
}
