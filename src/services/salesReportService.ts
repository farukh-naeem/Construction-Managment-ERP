import { api } from "./api";

export type SalesReportRowKind = "purchase" | "sale" | "expense";

export interface ApiSalesReportRow {
  kind: SalesReportRowKind;
  id: string;
  date: string;
  /** Vendor name on a purchase, customer name on a sale, description on an expense. */
  party: string;
  itemName?: string;
  unit?: string;
  purchaseQty?: number;
  purchaseRate?: number;
  purchaseAmount?: number;
  saleQty?: number;
  saleRate?: number;
  saleAmount?: number;
  /** Cost of the units sold, valued at the latest purchase rate on or before the sale date. */
  cogs?: number;
  expense?: number;
  balanceStock?: number;
  stockAmount?: number;
  grossPL?: number;
  netPL?: number;
  totalNetPL?: number;
}

export interface ApiSalesReportTotals {
  purchaseQty: number;
  purchaseAmount: number;
  saleQty: number;
  saleAmount: number;
  cogs: number;
  expense: number;
  balanceStock: number;
  stockAmount: number;
  grossPL: number;
  netPL: number;
}

export interface ApiSalesReport {
  rows: ApiSalesReportRow[];
  totals: ApiSalesReportTotals;
}

export async function getSalesReport(params: {
  projectId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}): Promise<ApiSalesReport> {
  const search = new URLSearchParams();
  if (params.projectId) search.set("projectId", params.projectId);
  if (params.startDate) search.set("startDate", params.startDate);
  if (params.endDate) search.set("endDate", params.endDate);
  const q = search.toString();
  return api<ApiSalesReport>(`/api/sales-report${q ? `?${q}` : ""}`);
}
