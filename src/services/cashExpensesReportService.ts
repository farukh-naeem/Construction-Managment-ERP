/**
 * Cash & Expenses report API — daily report for a project (opening balances + payments on date).
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

export interface CashExpensesReportBankAccount {
  id: string;
  name: string;
  openingBalance: number;
  closingBalance: number;
  inflows: number;
}

export interface CashExpensesReportOpeningBalances {
  projectLedger: number;
  projectLedgerClosing: number;
  projectLedgerInflows: number;
  bankAccounts: CashExpensesReportBankAccount[];
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
  date: string
): Promise<CashExpensesReport> {
  const params = new URLSearchParams({ date });
  return api<CashExpensesReport>(
    `/api/projects/${projectId}/cash-expenses-report?${params.toString()}`
  );
}
