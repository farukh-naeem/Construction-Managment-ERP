/**
 * Machines API service - CRUD and ledger
 */

import { api } from "./api";

export interface ApiMachine {
  id: string;
  projectId: string;
  name: string;
  ownership: "Company Owned" | "Rented";
  hourlyRate: number;
}

export interface ApiMachineWithTotals extends ApiMachine {
  totalDiesel: number;
  totalHours: number;
  totalCost: number;
  totalPaid: number;
  totalPending: number;
  /** Unconsumed advance sitting with the owner — max(0, totalPaid - totalCost). Receivable side. */
  totalAdvance: number;
}

export interface ListMachinesParams {
  projectId?: string | null;
  page?: number;
  pageSize?: number;
  /** Optional inclusive date range — when both set, totals reflect that period instead of all-time. */
  startDate?: string | null;
  endDate?: string | null;
}

export interface ListMachinesResult {
  items: ApiMachineWithTotals[];
  total: number;
}

export interface ApiMachineRunningBillRow extends ApiMachine {
  currentHours: number;
  previousHours: number;
  totalHours: number;
  thisBill: number;
  previousBill: number;
  totalAmount: number;
  /** Payments recorded before periodStart. */
  previousBillAdvance: number;
  /** Payments recorded within [periodStart, periodEnd]. */
  thisBillAdvance: number;
}

export interface ApiRunningBillSummary {
  currentHours: number;
  previousHours: number;
  totalHours: number;
  thisBill: number;
  previousBill: number;
  totalAmount: number;
  previousBillAdvance: number;
  thisBillAdvance: number;
}

export interface ListMachinesRunningBillResult {
  items: ApiMachineRunningBillRow[];
  total: number;
  periodStart: string;
  periodEnd: string;
  summary: ApiRunningBillSummary;
}

export interface ListMachinesRunningBillParams {
  projectId?: string | null;
  periodStart: string;
  periodEnd: string;
  page?: number;
  pageSize?: number;
}

export interface CreateMachineInput {
  projectId?: string;
  name: string;
  ownership: "Company Owned" | "Rented";
  hourlyRate: number;
}

export interface UpdateMachineInput {
  name?: string;
  hourlyRate?: number;
}

export async function listMachines(params: ListMachinesParams): Promise<ListMachinesResult> {
  const search = new URLSearchParams();
  if (params.projectId != null && params.projectId !== "") search.set("projectId", params.projectId);
  if (params.page != null) search.set("page", String(params.page));
  if (params.pageSize != null) search.set("pageSize", String(params.pageSize));
  if (params.startDate) search.set("startDate", params.startDate);
  if (params.endDate) search.set("endDate", params.endDate);
  const q = search.toString();
  return api<ListMachinesResult>(`/api/machines${q ? `?${q}` : ""}`);
}

export async function listMachinesRunningBill(
  params: ListMachinesRunningBillParams
): Promise<ListMachinesRunningBillResult> {
  const search = new URLSearchParams();
  if (params.projectId != null && params.projectId !== "") search.set("projectId", params.projectId);
  search.set("periodStart", params.periodStart);
  search.set("periodEnd", params.periodEnd);
  if (params.page != null) search.set("page", String(params.page));
  if (params.pageSize != null) search.set("pageSize", String(params.pageSize));
  return api<ListMachinesRunningBillResult>(`/api/machines/running-bill?${search.toString()}`);
}

export async function getMachine(id: string): Promise<ApiMachineWithTotals> {
  return api<ApiMachineWithTotals>(`/api/machines/${id}`);
}

export async function createMachine(input: CreateMachineInput): Promise<ApiMachine> {
  return api<ApiMachine>("/api/machines", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateMachine(id: string, input: UpdateMachineInput): Promise<ApiMachine> {
  return api<ApiMachine>(`/api/machines/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteMachine(id: string): Promise<void> {
  return api<void>(`/api/machines/${id}`, {
    method: "DELETE",
  });
}

// --- Machine Ledger ---

export interface ApiMachineLedgerEntryRow {
  type: "entry";
  id: string;
  machineId: string;
  date: string;
  hoursWorked: number;
  usedBy?: string;
  totalCost: number;
  paidAmount: number;
  remaining: number;
  remarks?: string;
  /** Running balance owed as of this row's date. */
  runningTotal: number;
}

/** Separate row for each payment so the record shows "on this date, payment was made" */
export interface ApiMachineLedgerPaymentRow {
  type: "payment";
  id: string;
  date: string;
  amount: number;
  paymentMethod?: "Cash" | "Bank" | "Online";
  referenceId?: string;
  /** Running balance owed as of this row's date. */
  runningTotal: number;
}

export type ApiMachineLedgerRow = ApiMachineLedgerEntryRow | ApiMachineLedgerPaymentRow;

export interface ApiMachineLedgerResult {
  rows: ApiMachineLedgerRow[];
  total: number;
  totalHours: number;
  totalCost: number;
  totalPaid: number;
  remaining: number;
  /** Opening amount owed carried in from before startDate (0 when no date filter is applied). */
  previousBalance: number;
}

/** @deprecated Use ApiMachineLedgerEntryRow for entry rows */
export type ApiMachineLedgerEntry = ApiMachineLedgerEntryRow;

export interface CreateMachineEntryInput {
  date: string;
  hoursWorked: number;
  dieselLitres?: number;
  usedBy?: string;
  remarks?: string;
}

export interface BulkMachineEntry {
  machineId: string;
  hoursWorked: number;
  dieselLitres?: number;
  usedBy?: string;
  remarks?: string;
}

export async function createMachineEntriesBulk(input: {
  projectId: string; date: string; entries: BulkMachineEntry[];
}): Promise<{ created: number }> {
  return api("/api/machines/bulk-ledger", { method: "POST", body: JSON.stringify(input) });
}

export interface CreateMachinePaymentInput {
  date: string;
  amount: number;
  paymentMethod?: "Cash" | "Bank" | "Online";
  referenceId?: string;
}

export async function getMachineLedger(
  machineId: string,
  params?: { page?: number; pageSize?: number; startDate?: string; endDate?: string }
): Promise<ApiMachineLedgerResult> {
  const search = new URLSearchParams();
  if (params?.page != null) search.set("page", String(params.page));
  if (params?.pageSize != null) search.set("pageSize", String(params.pageSize));
  if (params?.startDate) search.set("startDate", params.startDate);
  if (params?.endDate) search.set("endDate", params.endDate);
  const q = search.toString();
  return api<ApiMachineLedgerResult>(`/api/machines/${machineId}/ledger${q ? `?${q}` : ""}`);
}

export async function createMachineEntry(
  machineId: string,
  input: CreateMachineEntryInput
): Promise<ApiMachineLedgerEntryRow> {
  return api<ApiMachineLedgerEntryRow>(`/api/machines/${machineId}/ledger/entries`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function createMachinePayment(
  machineId: string,
  input: CreateMachinePaymentInput
): Promise<{ id: string; machineId: string; date: string; amount: number }> {
  return api(`/api/machines/${machineId}/ledger/payments`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function deleteMachineLedgerEntry(machineId: string, entryId: string): Promise<void> {
  return api<void>(`/api/machines/${machineId}/ledger/entries/${entryId}`, {
    method: "DELETE",
  });
}

export async function deleteMachinePayment(machineId: string, paymentId: string): Promise<void> {
  return api<void>(`/api/machines/${machineId}/ledger/payments/${paymentId}`, {
    method: "DELETE",
  });
}
