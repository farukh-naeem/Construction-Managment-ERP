/**
 * Cash & Expenses report API — period report for a project.
 */

import { api } from "./api";

export type CashExpensesEntityType =
  | "Consumable"
  | "NonConsumable"
  | "Vendor"
  | "Contractor"
  | "Salary"
  | "Expense"
  | "Machinery";

export interface CashExpensesReportPayment {
  entityName: string;
  entityType: CashExpensesEntityType;
  amount: number;
  previousAmount: number;
  totalAmount: number;
  remarks: string;
  sourceId?: string;
  entityId: string;
}

export interface CashExpensesLedgerEntry {
  id: string;
  date: string;
  name: string;
  remarks: string;
  amount: number;
}

export interface CashExpensesEntityLedger {
  entityName: string;
  entityType: CashExpensesEntityType;
  previousAmount: number;
  entries: CashExpensesLedgerEntry[];
  currentTotal: number;
}

export interface CashExpensesReportOpeningBalances {
  projectLedger: number;
  projectLedgerClosing: number;
  projectLedgerInflows: number;
  openingRow: {
    current: number;
    previous: number;
    total: number;
    tPayment: number;
  };
  inflowTransactions: {
    id: string;
    date: string;
    source: string;
    remarks: string;
    current: number;
    previous: number;
    total: number;
    tPayment: number;
  }[];
}

export interface CashExpensesReportReceipt {
  id: string;
  date: string;
  description: string;
  amount: number;
  source?: string;
  destination?: string;
}

export interface CashExpensesReport {
  openingBalances: CashExpensesReportOpeningBalances;
  payments: CashExpensesReportPayment[];
  totalPayments: number;
  closingBalance: number;
  receipts?: CashExpensesReportReceipt[];
  totalReceipts?: number;
}

export async function getCashExpensesEntityLedger(
  projectId: string,
  entityType: CashExpensesEntityType,
  entityId: string,
  startDate: string,
  endDate: string
): Promise<CashExpensesEntityLedger> {
  const params = new URLSearchParams({ entityType, entityId, startDate, endDate });
  return api<CashExpensesEntityLedger>(
    `/api/projects/${projectId}/cash-expenses-report/ledger?${params.toString()}`
  );
}

export async function getCashExpensesReport(
  projectId: string,
  startDate: string,
  endDate: string
): Promise<CashExpensesReport> {
  const params = new URLSearchParams({ startDate, endDate });
  return api<CashExpensesReport>(
    `/api/projects/${projectId}/cash-expenses-report?${params.toString()}`
  );
}
