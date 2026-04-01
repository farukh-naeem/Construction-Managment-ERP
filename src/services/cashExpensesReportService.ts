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
