import { api } from "./api";

export interface ApiVendorPayment {
  id: string;
  vendorId: string;
  date: string;
  amount: number;
  paymentMethod: "Cash" | "Bank" | "Online";
  source: "external" | "advance";
  advancePortion: number;
  referenceId?: string;
  remarks?: string;
}

export interface ApiVendorLedgerRow {
  type: "purchase" | "payment" | "purchase_return";
  id: string;
  date: string;
  itemName?: string;
  quantity?: number;
  unitPrice?: number;
  totalPrice?: number;
  paidAmount?: number;
  remaining?: number;
  advanceGenerated?: number;
  amount?: number;
  source?: "external" | "advance";
  paymentMethod: "Cash" | "Bank" | "Online";
  referenceId?: string;
  remarks?: string;
  /** Signed running balance owed as of this row's date. */
  runningTotal: number;
}

export interface ApiVendorLedger {
  rows: ApiVendorLedgerRow[];
  totalBilled: number;
  totalPaid: number;
  remaining: number;
  advanceBalance: number;
  /** Signed opening balance carried in from before startDate (0 when no startDate filter is applied). */
  previousBalance: number;
  total: number;
}

export interface GetVendorLedgerParams {
  page?: number;
  pageSize?: number;
  startDate?: string;
  endDate?: string;
}

export interface CreateVendorPaymentInput {
  date: string;
  amount: number;
  paymentMethod: "Cash" | "Bank" | "Online";
  /** "external" (default) = fresh payment; excess over the vendor's remaining becomes advance.
   *  "advance" = settle a due by drawing down the vendor's existing advance balance. */
  source?: "external" | "advance";
  /** Pins this payment to one specific item ledger entry so it settles that bill directly
   *  instead of FIFO redirecting it to whichever bill is oldest. */
  targetEntryId?: string;
  referenceId?: string;
  remarks?: string;
}

export async function getVendorLedger(
  vendorId: string,
  params?: GetVendorLedgerParams
): Promise<ApiVendorLedger> {
  const sp = new URLSearchParams();
  if (params?.page != null) sp.set("page", String(params.page));
  if (params?.pageSize != null) sp.set("pageSize", String(params.pageSize));
  if (params?.startDate) sp.set("startDate", params.startDate);
  if (params?.endDate) sp.set("endDate", params.endDate);
  const q = sp.toString();
  return api<ApiVendorLedger>(`/api/vendors/${vendorId}/ledger${q ? `?${q}` : ""}`);
}

export async function createVendorPayment(
  vendorId: string,
  input: CreateVendorPaymentInput
): Promise<ApiVendorPayment> {
  return api<ApiVendorPayment>(`/api/vendors/${vendorId}/payments`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function deleteVendorPayment(vendorId: string, paymentId: string): Promise<void> {
  return api<void>(`/api/vendors/${vendorId}/payments/${paymentId}`, { method: "DELETE" });
}
