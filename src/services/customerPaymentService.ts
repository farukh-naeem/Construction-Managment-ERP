import { api } from "./api";

export type PaymentMethod = "Cash" | "Bank" | "Online";

export interface ApiCustomerPayment {
  id: string;
  customerId: string;
  date: string;
  amount: number;
  paymentMethod: PaymentMethod;
  accountId: string;
  accountName?: string;
  referenceId?: string;
  remarks?: string;
}

export interface ApiCustomerLedgerRow {
  type: "sale" | "payment" | "sale_return";
  id: string;
  date: string;
  /** Sale rows only: groups every line of one "Sell Items" submission. */
  saleId?: string;
  itemName?: string;
  quantity?: number;
  unit?: string;
  unitPrice?: number;
  totalPrice?: number;
  /** Payment rows only. */
  amount?: number;
  paymentMethod?: PaymentMethod;
  accountName?: string;
  referenceId?: string;
  remarks?: string;
  /** Signed running balance. Payments credit (+); sales debit (−). Negative = customer owes us. */
  runningTotal: number;
}

export interface ApiCustomerLedger {
  rows: ApiCustomerLedgerRow[];
  totalSold: number;
  totalReceived: number;
  /** Signed: positive = credit held; negative = receivable. */
  balance: number;
  receivable: number;
  credit: number;
  /** Signed opening balance carried in from before startDate (0 when no startDate filter). */
  previousBalance: number;
  total: number;
}

export interface GetCustomerLedgerParams {
  page?: number;
  pageSize?: number;
  startDate?: string;
  endDate?: string;
}

export interface CreateCustomerPaymentInput {
  date: string;
  amount: number;
  paymentMethod: PaymentMethod;
  /** Required: the bank account the money lands in as an inflow. */
  accountId: string;
  referenceId?: string;
  remarks?: string;
}

export async function getCustomerLedger(
  customerId: string,
  params: GetCustomerLedgerParams = {}
): Promise<ApiCustomerLedger> {
  const search = new URLSearchParams();
  if (params.page) search.set("page", String(params.page));
  if (params.pageSize) search.set("pageSize", String(params.pageSize));
  if (params.startDate) search.set("startDate", params.startDate);
  if (params.endDate) search.set("endDate", params.endDate);
  const q = search.toString();
  return api<ApiCustomerLedger>(`/api/customers/${customerId}/ledger${q ? `?${q}` : ""}`);
}

export async function createCustomerPayment(
  customerId: string,
  input: CreateCustomerPaymentInput
): Promise<ApiCustomerPayment> {
  return api<ApiCustomerPayment>(`/api/customers/${customerId}/payments`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function deleteCustomerPayment(customerId: string, paymentId: string): Promise<void> {
  return api<void>(`/api/customers/${customerId}/payments/${paymentId}`, {
    method: "DELETE",
  });
}
