import mongoose from "mongoose";
import { ItemLedgerEntry } from "../models/ItemLedgerEntry.js";
import { CustomerSaleEntry } from "../models/CustomerSaleEntry.js";
import { ConsumableItem } from "../models/ConsumableItem.js";
import { Vendor } from "../models/Vendor.js";
import { Customer } from "../models/Customer.js";
import { Expense } from "../models/Expense.js";
import { resolveSiteManagerProjectId } from "./projectAccessService.js";

export type SalesReportRowKind = "purchase" | "sale" | "expense";

export interface SalesReportRow {
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
  /** The day's project expense, charged once to the first sale row of that date. */
  expense?: number;
  balanceStock?: number;
  stockAmount?: number;
  grossPL?: number;
  netPL?: number;
  /** Running cumulative Net P/L across the filtered period. */
  totalNetPL?: number;
}

export interface SalesReportTotals {
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

export interface SalesReportResult {
  rows: SalesReportRow[];
  totals: SalesReportTotals;
}

/**
 * Ordering rank used twice, for two different reasons:
 *  - processing: on a shared date a purchase must settle the running rate before the sale
 *    that draws on it, and an expense is charged only after its date's sales are known;
 *  - display: the finished report is grouped into purchase, then sale, then expense
 *    sections, matching the register it replaces.
 */
const KIND_RANK: Record<SalesReportRowKind, number> = { purchase: 0, sale: 1, expense: 2 };

interface ReportEvent {
  kind: SalesReportRowKind;
  id: string;
  date: string;
  itemId?: string;
  doc: Record<string, unknown>;
}

/**
 * Combined purchase + sale report for consumable stock, mirroring the manual register:
 * every purchase and sale as a row, a per-item running stock, and cumulative profit.
 *
 * Stock and cost rates are carried forward from ALL history so a filtered window still
 * values its sales correctly; only rows dated inside the window are returned, and the
 * profit total restarts at zero for the period.
 */
export async function getSalesReport(
  actor: { userId: string; role: string },
  projectIdParam?: string,
  options?: { startDate?: string; endDate?: string }
): Promise<SalesReportResult> {
  let projectId: string | undefined;
  if (actor.role === "site_manager") {
    projectId = await resolveSiteManagerProjectId(actor.userId, projectIdParam);
  } else {
    projectId = projectIdParam;
  }

  const empty: SalesReportResult = {
    rows: [],
    totals: {
      purchaseQty: 0, purchaseAmount: 0, saleQty: 0, saleAmount: 0, cogs: 0,
      expense: 0, balanceStock: 0, stockAmount: 0, grossPL: 0, netPL: 0,
    },
  };
  if (!projectId || !mongoose.Types.ObjectId.isValid(projectId)) return empty;

  const startDate = options?.startDate?.trim() || undefined;
  const endDate = options?.endDate?.trim() || undefined;
  const inRange = (date: string) =>
    (!startDate || date >= startDate) && (!endDate || date <= endDate);

  // Expenses are the one input taken from the filtered window only.
  const expenseMatch: Record<string, unknown> = { projectId };
  if (startDate || endDate) {
    const range: Record<string, string> = {};
    if (startDate) range.$gte = startDate;
    if (endDate) range.$lte = endDate;
    expenseMatch.date = range;
  }

  const [purchases, sales, expenses] = await Promise.all([
    ItemLedgerEntry.find({ projectId }).sort({ date: 1, createdAt: 1 }).lean(),
    CustomerSaleEntry.find({ projectId }).sort({ date: 1, createdAt: 1 }).lean(),
    Expense.find(expenseMatch).sort({ date: 1, createdAt: 1 }).lean(),
  ]);

  const itemIds = [
    ...new Set([...purchases, ...sales].map((r) => r.itemId.toString())),
  ];
  const [items, vendors, customers] = await Promise.all([
    ConsumableItem.find({ _id: { $in: itemIds } }).select("name").lean(),
    Vendor.find({ _id: { $in: [...new Set(purchases.map((p) => p.vendorId.toString()))] } })
      .select("name").lean(),
    Customer.find({ _id: { $in: [...new Set(sales.map((s) => s.customerId.toString()))] } })
      .select("name").lean(),
  ]);
  const itemNames = new Map(items.map((i) => [i._id.toString(), i.name]));
  const vendorNames = new Map(vendors.map((v) => [v._id.toString(), v.name]));
  const customerNames = new Map(customers.map((c) => [c._id.toString(), c.name]));

  const events: ReportEvent[] = [
    ...purchases.map((p) => ({
      kind: "purchase" as const, id: p._id.toString(), date: p.date,
      itemId: p.itemId.toString(), doc: p as unknown as Record<string, unknown>,
    })),
    ...sales.map((s) => ({
      kind: "sale" as const, id: s._id.toString(), date: s.date,
      itemId: s.itemId.toString(), doc: s as unknown as Record<string, unknown>,
    })),
    ...expenses.map((e) => ({
      kind: "expense" as const, id: e._id.toString(), date: e.date,
      doc: e as unknown as Record<string, unknown>,
    })),
  ].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
      a.id.localeCompare(b.id)
  );

  // The day's expense is charged in full to that date's first sale row, so a day with
  // several sales still subtracts it exactly once across the period.
  const expenseByDate = new Map<string, number>();
  for (const e of expenses) {
    const amount = (e.amount as number) ?? 0;
    expenseByDate.set(e.date, (expenseByDate.get(e.date) ?? 0) + amount);
  }
  const expenseCharged = new Set<string>();

  const balanceByItem = new Map<string, number>();
  const rateByItem = new Map<string, number>();

  const rows: SalesReportRow[] = [];
  const shownItems = new Set<string>();
  let runningNetPL = 0;

  for (const event of events) {
    // Events are date-ascending, so anything past the window cannot affect a report that
    // ends at endDate — including the closing stock and rate carried into the totals.
    if (endDate && event.date > endDate) break;

    if (event.kind === "purchase") {
      const doc = event.doc as unknown as {
        vendorId: mongoose.Types.ObjectId; quantity: number; unit?: string;
        unitPrice: number; totalPrice: number;
      };
      const itemId = event.itemId!;
      balanceByItem.set(itemId, (balanceByItem.get(itemId) ?? 0) + doc.quantity);
      // Latest purchase rate wins: every later sale is costed at this rate until the next buy.
      rateByItem.set(itemId, doc.unitPrice);

      if (!inRange(event.date)) continue;
      shownItems.add(itemId);
      rows.push({
        kind: "purchase",
        id: event.id,
        date: event.date,
        party: vendorNames.get(doc.vendorId.toString()) ?? "Unknown vendor",
        itemName: itemNames.get(itemId) ?? "Unknown item",
        unit: doc.unit,
        purchaseQty: doc.quantity,
        purchaseRate: doc.unitPrice,
        purchaseAmount: doc.totalPrice,
      });
      continue;
    }

    if (event.kind === "sale") {
      const doc = event.doc as unknown as {
        customerId: mongoose.Types.ObjectId; quantity: number; unit?: string;
        unitPrice: number; totalPrice: number;
      };
      const itemId = event.itemId!;
      const costRate = rateByItem.get(itemId) ?? 0;
      const balance = (balanceByItem.get(itemId) ?? 0) - doc.quantity;
      balanceByItem.set(itemId, balance);

      if (!inRange(event.date)) continue;
      shownItems.add(itemId);

      const cogs = doc.quantity * costRate;
      const grossPL = doc.totalPrice - cogs;
      let expense = 0;
      if (!expenseCharged.has(event.date)) {
        expense = expenseByDate.get(event.date) ?? 0;
        expenseCharged.add(event.date);
      }
      const netPL = grossPL - expense;
      runningNetPL += netPL;

      rows.push({
        kind: "sale",
        id: event.id,
        date: event.date,
        party: customerNames.get(doc.customerId.toString()) ?? "Unknown customer",
        itemName: itemNames.get(itemId) ?? "Unknown item",
        unit: doc.unit,
        saleQty: doc.quantity,
        saleRate: doc.unitPrice,
        saleAmount: doc.totalPrice,
        cogs,
        expense,
        balanceStock: balance,
        stockAmount: balance * costRate,
        grossPL,
        netPL,
        totalNetPL: runningNetPL,
      });
      continue;
    }

    const doc = event.doc as unknown as { description: string; category: string; amount: number };
    // Sales for a date are processed before its expenses, so an uncharged date here is one
    // with no sale to absorb the cost. Charge the day's expense on this row instead, or it
    // would silently vanish from the period's profit.
    let netPL: number | undefined;
    let totalNetPL: number | undefined;
    if (!expenseCharged.has(event.date)) {
      expenseCharged.add(event.date);
      netPL = -(expenseByDate.get(event.date) ?? 0);
      runningNetPL += netPL;
      totalNetPL = runningNetPL;
    }
    rows.push({
      kind: "expense",
      id: event.id,
      date: event.date,
      party: doc.description || doc.category || "Expense",
      expense: doc.amount,
      netPL,
      totalNetPL,
    });
  }

  // Display grouping only — every figure above was computed in strict date order, so
  // reordering here changes the layout and nothing else.
  rows.sort(
    (a, b) =>
      KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
      a.date.localeCompare(b.date) ||
      a.id.localeCompare(b.id)
  );

  const totals = rows.reduce<SalesReportTotals>(
    (acc, row) => ({
      purchaseQty: acc.purchaseQty + (row.purchaseQty ?? 0),
      purchaseAmount: acc.purchaseAmount + (row.purchaseAmount ?? 0),
      saleQty: acc.saleQty + (row.saleQty ?? 0),
      saleAmount: acc.saleAmount + (row.saleAmount ?? 0),
      cogs: acc.cogs + (row.cogs ?? 0),
      // Expense rows carry the day's total; sale rows repeat the same figure as the
      // amount charged to profit, so only count it from the expense rows.
      expense: acc.expense + (row.kind === "expense" ? row.expense ?? 0 : 0),
      // Carried through untouched — closing stock is computed per item below.
      balanceStock: acc.balanceStock,
      stockAmount: acc.stockAmount,
      grossPL: acc.grossPL + (row.grossPL ?? 0),
      netPL: acc.netPL + (row.netPL ?? 0),
    }),
    {
      purchaseQty: 0, purchaseAmount: 0, saleQty: 0, saleAmount: 0, cogs: 0,
      expense: 0, balanceStock: 0, stockAmount: 0, grossPL: 0, netPL: 0,
    }
  );

  // Balance Stock and Stock Amount are running positions, not per-row amounts, so the
  // totals are each item's CLOSING figure rather than a sum down the column — otherwise
  // an item with two sale rows would be counted twice.
  for (const itemId of shownItems) {
    const balance = balanceByItem.get(itemId) ?? 0;
    totals.balanceStock += balance;
    totals.stockAmount += balance * (rateByItem.get(itemId) ?? 0);
  }

  return { rows, totals };
}
