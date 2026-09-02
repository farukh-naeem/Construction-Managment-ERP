import type { ReactNode } from "react";
import type { ApiSalesReportRow, ApiSalesReportTotals } from "@/services/salesReportService";
import { formatDisplayDate } from "@/lib/pktDate";

/**
 * Column model for the Purchase & Sales report. Header, body and totals all render from
 * this one list so the six compartments and the 17 columns can never drift out of line.
 */
export interface SalesReportColumn {
  key: string;
  label: string;
  /** Percentage of table width — the table is fixed-layout so it never needs to scroll. */
  width: string;
  align: "left" | "right";
  /** First column of a compartment: draws the heavy divider on screen and in print. */
  groupStart?: boolean;
  cell: (row: ApiSalesReportRow) => ReactNode;
  cellClass?: (row: ApiSalesReportRow) => string;
  total?: (totals: ApiSalesReportTotals) => ReactNode;
  totalClass?: (totals: ApiSalesReportTotals) => string;
}

/**
 * Whole numbers print bare, matching the register this report replaces; only genuinely
 * fractional values carry decimals. Dropping a blanket ".00" is what lets 17 columns fit.
 */
function money(value?: number | null): string {
  if (value == null) return "—";
  return Number.isInteger(value)
    ? value.toLocaleString("en-US")
    : value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function qty(value?: number | null): string {
  if (value == null) return "—";
  return Number.isInteger(value)
    ? value.toLocaleString("en-US")
    : value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const negative = (value?: number | null) => ((value ?? 0) < 0 ? "text-destructive" : "");

export const SALES_REPORT_GROUPS: { label: string; span: number }[] = [
  { label: "", span: 5 },
  { label: "Purchase", span: 2 },
  { label: "Sale", span: 3 },
  { label: "Cost & Expense", span: 2 },
  { label: "Stock", span: 2 },
  { label: "Profit / Loss", span: 3 },
];

export const SALES_REPORT_COLUMNS: SalesReportColumn[] = [
  {
    key: "date", label: "Date", width: "6%", align: "left",
    cell: (row) => formatDisplayDate(row.date),
  },
  {
    key: "party", label: "Vendor / Customer", width: "9%", align: "left",
    cell: (row) => row.party,
    cellClass: () => "font-bold",
  },
  {
    key: "item", label: "Item Name", width: "7.5%", align: "left",
    cell: (row) => row.itemName ?? (row.kind === "expense" ? "EXP" : "—"),
  },
  {
    key: "purchaseQty", label: "Qty", width: "5.5%", align: "right",
    cell: (row) => qty(row.purchaseQty),
    total: (t) => qty(t.purchaseQty),
  },
  {
    key: "unit", label: "Unit", width: "4%", align: "left",
    cell: (row) => row.unit || "—",
  },
  {
    key: "purchaseRate", label: "Rate", width: "6%", align: "right", groupStart: true,
    cell: (row) => money(row.purchaseRate),
  },
  {
    key: "purchaseAmount", label: "Amount", width: "7.5%", align: "right",
    cell: (row) => money(row.purchaseAmount),
    total: (t) => money(t.purchaseAmount),
  },
  {
    key: "saleQty", label: "Qty", width: "5%", align: "right", groupStart: true,
    cell: (row) => qty(row.saleQty),
    total: (t) => qty(t.saleQty),
  },
  {
    key: "saleRate", label: "Rate", width: "6.5%", align: "right",
    cell: (row) => money(row.saleRate),
  },
  {
    key: "saleAmount", label: "Amount", width: "7.5%", align: "right",
    cell: (row) => money(row.saleAmount),
    cellClass: (row) => (row.saleAmount != null ? "text-success" : ""),
    total: (t) => money(t.saleAmount),
    totalClass: () => "text-success",
  },
  {
    key: "cogs", label: "Cost of Purchase", width: "7.5%", align: "right", groupStart: true,
    cell: (row) => money(row.cogs),
    total: (t) => money(t.cogs),
  },
  {
    key: "expense", label: "Expense / Day", width: "6%", align: "right",
    cell: (row) => (row.expense ? money(row.expense) : "—"),
    cellClass: (row) => (row.expense ? "text-destructive" : ""),
    total: (t) => money(t.expense),
    totalClass: () => "text-destructive",
  },
  {
    key: "balanceStock", label: "Balance", width: "6%", align: "right", groupStart: true,
    cell: (row) => qty(row.balanceStock),
    total: (t) => qty(t.balanceStock),
  },
  {
    key: "stockAmount", label: "Value", width: "7%", align: "right",
    cell: (row) => money(row.stockAmount),
    total: (t) => money(t.stockAmount),
  },
  {
    key: "grossPL", label: "Gross", width: "6.5%", align: "right", groupStart: true,
    cell: (row) => money(row.grossPL),
    cellClass: (row) => negative(row.grossPL),
    total: (t) => money(t.grossPL),
    totalClass: (t) => negative(t.grossPL),
  },
  {
    key: "netPL", label: "Net", width: "6.5%", align: "right",
    cell: (row) => money(row.netPL),
    cellClass: (row) => negative(row.netPL),
    total: (t) => money(t.netPL),
    totalClass: (t) => negative(t.netPL),
  },
  {
    key: "totalNetPL", label: "Cumulative", width: "6%", align: "right",
    cell: (row) => money(row.totalNetPL),
    cellClass: (row) => `font-bold ${negative(row.totalNetPL)}`,
    total: (t) => money(t.netPL),
    totalClass: (t) => negative(t.netPL),
  },
];

/**
 * The print document has no Tailwind, so the compartment dividers and the fixed layout
 * are restated here. Cells must wrap rather than nowrap — with table-layout:fixed a
 * nowrap cell overflows its column and prints on top of its neighbour.
 */
export const SALES_REPORT_PRINT_CSS = `
  @page { size: A4 landscape; margin: 10mm 8mm; }
  .sales-report-table { table-layout: fixed; width: 100%; }
  .sales-report-table th,
  .sales-report-table td {
    padding: 3px 4px;
    font-size: 8px;
    line-height: 1.2;
    white-space: normal;
    overflow-wrap: anywhere;
    border: 1px solid #000;
  }
  .sales-report-table thead th { font-size: 7.5px; letter-spacing: 0; }
  .sales-report-table .group-start { border-left: 2px solid #000 !important; }
`;
