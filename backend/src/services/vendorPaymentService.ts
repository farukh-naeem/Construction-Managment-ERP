import mongoose from "mongoose";
import { VendorPayment } from "../models/VendorPayment.js";
import { ItemLedgerEntry } from "../models/ItemLedgerEntry.js";
import { ConsumableItem } from "../models/ConsumableItem.js";
import { Vendor } from "../models/Vendor.js";
import { User } from "../models/User.js";
import { logAudit, getProjectName } from "./auditService.js";
import { roleDisplay } from "./authService.js";
import { InventoryReturn } from "../models/InventoryReturn.js";
import { BankAccount } from "../models/BankAccount.js";

export interface VendorPaymentPayload {
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

export interface CreateVendorPaymentInput {
  date: string;
  amount: number;
  paymentMethod: "Cash" | "Bank" | "Online";
  /** "external" (default) = fresh payment; any excess over the vendor's remaining becomes
   *  advance. "advance" = settle an outstanding due by drawing down the vendor's existing
   *  advance balance instead of paying fresh money. */
  source?: "external" | "advance";
  /** Pins this payment to one specific ItemLedgerEntry so FIFO settles that bill directly
   *  instead of redirecting the money to whichever bill happens to be oldest. Must belong to
   *  this vendor. Typically used with source "advance" ("apply this advance to this delivery"),
   *  but not restricted to it. */
  targetEntryId?: string;
  referenceId?: string;
  remarks?: string;
}

export interface VendorLedgerRow {
  type: "purchase" | "payment" | "purchase_return";
  id: string;
  date: string;
  /** For purchase rows: item name */
  itemName?: string;
  /** For purchase rows */
  quantity?: number;
  unitPrice?: number;
  totalPrice?: number;
  paidAmount?: number;
  remaining?: number;
  /** For purchase rows: how much of paidAmount exceeded totalPrice and became vendor advance */
  advanceGenerated?: number;
  /** For payment rows */
  amount?: number;
  /** For payment rows: "external" = fresh payment, "advance" = settled from existing advance balance */
  source?: "external" | "advance";
  paymentMethod: "Cash" | "Bank" | "Online";
  referenceId?: string;
  remarks?: string;
  /** Running amount owed to the vendor. Purchases add debit; cash payments add credit. */
  runningTotal: number;
}

function toPayload(doc: {
  _id: mongoose.Types.ObjectId;
  vendorId: mongoose.Types.ObjectId;
  date: string;
  amount: number;
  paymentMethod: "Cash" | "Bank" | "Online";
  source: "external" | "advance";
  advancePortion: number;
  referenceId?: string;
  remarks?: string;
}): VendorPaymentPayload {
  return {
    id: doc._id.toString(),
    vendorId: doc.vendorId.toString(),
    date: doc.date,
    amount: doc.amount,
    paymentMethod: doc.paymentMethod,
    source: doc.source,
    advancePortion: doc.advancePortion,
    referenceId: doc.referenceId,
    remarks: doc.remarks,
  };
}

const DEFAULT_PAGE_SIZE = 12;

export interface GetVendorLedgerOptions {
  page?: number;
  pageSize?: number;
  startDate?: string;
  endDate?: string;
}

/**
 * Returns the combined "vendor ledger": item purchase rows + payment rows, sorted by date desc.
 * Also returns computed totals. Supports pagination (default pageSize 12).
 */
export async function getVendorLedger(
  vendorId: string,
  options?: GetVendorLedgerOptions
): Promise<{
  rows: VendorLedgerRow[];
  totalBilled: number;
  totalPaid: number;
  remaining: number;
  /** Vendor's current advance balance — stored/incremental (see Vendor.advanceBalance), not
   *  recomputed from raw rows like the other totals here. */
  advanceBalance: number;
  /** Signed opening balance carried in from before startDate (0 when no startDate filter is applied). */
  previousBalance: number;
  total: number;
}> {
  if (!mongoose.Types.ObjectId.isValid(vendorId)) {
    return { rows: [], totalBilled: 0, totalPaid: 0, remaining: 0, advanceBalance: 0, previousBalance: 0, total: 0 };
  }

  const startDate = options?.startDate?.trim() || undefined;
  const endDate = options?.endDate?.trim() || undefined;

  // Stats always reflect the vendor's full
  // history — only the displayed rows and the running balance react to the date range, exactly
  // like the Machinery ledger (getMachineTotals is all-time; only rows are range-filtered).
  const [vendor, ledgerEntries, payments, returns] = await Promise.all([
    Vendor.findById(vendorId).select("advanceBalance").lean(),
    ItemLedgerEntry.find({ vendorId }).sort({ date: -1 }).lean(),
    VendorPayment.find({ vendorId }).sort({ date: -1 }).lean(),
    InventoryReturn.find({ vendorId, type: "purchase_return" }).sort({ date: -1 }).lean(),
  ]);

  const itemIds = [...new Set([...ledgerEntries.map((e) => e.itemId.toString()), ...returns.flatMap((r) => r.items.map((line) => line.itemId.toString()))])];
  const accountIds = [...new Set(returns.map((r) => r.accountId.toString()))];
  const [itemDocs, accountDocs] = await Promise.all([
    ConsumableItem.find({ _id: { $in: itemIds } }).select("name").lean(),
    BankAccount.find({ _id: { $in: accountIds } }).select("name").lean(),
  ]);
  const itemMap = new Map(itemDocs.map((i) => [i._id.toString(), i.name]));
  const accountMap = new Map(accountDocs.map((a) => [a._id.toString(), a.name]));

  let totalBilled = 0;
  let totalPaidFromLedger = 0;

  const purchaseRows: VendorLedgerRow[] = ledgerEntries.map((e) => {
    totalBilled += e.totalPrice;
    totalPaidFromLedger += e.paidAmount + (e.advanceGenerated ?? 0);
    return {
      type: "purchase",
      id: e._id.toString(),
      date: e.date,
      itemName: itemMap.get(e.itemId.toString()) ?? "Unknown",
      quantity: e.quantity,
      unitPrice: e.unitPrice,
      totalPrice: e.totalPrice,
      paidAmount: e.paidAmount,
      remaining: e.remaining,
      advanceGenerated: e.advanceGenerated,
      paymentMethod: e.paymentMethod,
      referenceId: e.referenceId,
      remarks: e.remarks,
      runningTotal: 0, // filled in below
    };
  });

  // `totalPaid` (display stat) counts every dollar ever handed to the vendor, including the
  // portion of an overpayment that became advance instead of settling a due. `remaining`
  // must NOT be reduced by that advance-generating portion — only by whatever actually applied
  // against an outstanding due — so the two are tracked separately.
  let totalPaidFromPayments = 0;
  const paymentRows: VendorLedgerRow[] = payments.map((p) => {
    const isAdvance = p.source === "advance";
    if (!isAdvance) totalPaidFromPayments += p.amount;
    return {
      type: "payment",
      id: p._id.toString(),
      date: p.date,
      amount: p.amount,
      source: p.source ?? "external",
      paymentMethod: p.paymentMethod,
      referenceId: p.referenceId,
      remarks: p.remarks,
      runningTotal: 0, // filled in below
    };
  });

  const returnRows: VendorLedgerRow[] = returns.map((entry) => ({
    type: "purchase_return", id: entry._id.toString(), date: entry.date,
    itemName: entry.items.map((line) => itemMap.get(line.itemId.toString()) ?? "Unknown item").join(", "),
    quantity: entry.items.reduce((sum, line) => sum + line.quantity, 0), totalPrice: entry.totalAmount,
    amount: entry.totalAmount, paymentMethod: entry.paymentMethod,
    referenceId: entry.referenceId, remarks: entry.remarks || `Purchase return refund into ${accountMap.get(entry.accountId.toString()) ?? "company account"}`,
    runningTotal: 0,
  }));

  const totalReturned = returns.reduce((sum, entry) => sum + entry.totalAmount, 0);
  totalBilled -= totalReturned;
  totalPaidFromPayments -= totalReturned;

  const totalPaid = totalPaidFromLedger + totalPaidFromPayments;
  // Signed balance is the source of truth: debit (purchase cost) minus credit (cash paid).
  // It intentionally remains negative when the vendor has been paid in advance.
  const remaining = totalBilled - totalPaid;

  // Debit/credit running balance: purchase cost is a debit (+); payment is a credit (-).
  // Legacy "advance applied" rows are a reallocation of an earlier payment, not fresh cash,
  // and therefore remain zero-impact.
  const ascendingRaw = [
    ...ledgerEntries.map((e) => ({
      key: `purchase:${e._id.toString()}`,
      id: e._id.toString(),
      date: e.date,
      delta: e.totalPrice - e.paidAmount - (e.advanceGenerated ?? 0),
    })),
    ...payments.map((p) => ({
      key: `payment:${p._id.toString()}`,
      id: p._id.toString(),
      date: p.date,
      delta: p.source === "advance" ? 0 : -p.amount,
    })),
    ...returns.map((r) => ({ key: `purchase_return:${r._id}`, id: r._id.toString(), date: r.date, delta: 0 })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

  const previousBalance = startDate
    ? ascendingRaw.filter((r) => r.date < startDate).reduce((s, r) => s + r.delta, 0)
    : 0;

  const runningByKey = new Map<string, number>();
  let running = previousBalance;
  for (const r of ascendingRaw) {
    if (startDate && r.date < startDate) continue;
    if (endDate && r.date > endDate) continue;
    running += r.delta;
    runningByKey.set(r.key, running);
  }

  const allRows = [...purchaseRows, ...paymentRows, ...returnRows]
    .filter((r) => (!startDate || r.date >= startDate) && (!endDate || r.date <= endDate))
    .map((r) => ({ ...r, runningTotal: runningByKey.get(`${r.type}:${r.id}`) ?? previousBalance }))
    // Oldest first. ObjectId preserves a consistent creation-order tie-break on the same date.
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const total = allRows.length;
  const pageSize = Math.min(Math.max(1, options?.pageSize ?? DEFAULT_PAGE_SIZE), 100);
  const page = Math.max(1, options?.page ?? 1);
  const start = (page - 1) * pageSize;
  const rows = allRows.slice(start, start + pageSize);

  return { rows, totalBilled, totalPaid, remaining, advanceBalance: Math.max(0, -remaining), previousBalance, total };
}

export async function createVendorPayment(
  actor: { userId: string; email: string; role: string },
  vendorId: string,
  input: CreateVendorPaymentInput
): Promise<VendorPaymentPayload> {
  if (!mongoose.Types.ObjectId.isValid(vendorId)) throw new Error("Invalid vendor ID");
  if (!input.date) throw new Error("Date is required");
  if (!input.amount || input.amount <= 0) throw new Error("Amount must be positive");
  if (!["Cash", "Bank", "Online"].includes(input.paymentMethod)) throw new Error("Invalid payment method");

  const vendor = await Vendor.findById(vendorId).lean();
  if (!vendor) throw new Error("Vendor not found");

  let targetEntryId: string | undefined;
  if (input.targetEntryId) {
    if (!mongoose.Types.ObjectId.isValid(input.targetEntryId)) throw new Error("Invalid target entry ID");
    const targetEntry = await ItemLedgerEntry.findById(input.targetEntryId).select("vendorId").lean();
    if (!targetEntry || targetEntry.vendorId.toString() !== vendorId) {
      throw new Error("Target entry does not belong to this vendor");
    }
    targetEntryId = input.targetEntryId;
  }

  const source = input.source ?? "external";
  if (source === "advance") {
    throw new Error("Applying advance is no longer supported; record a payment credit instead");
  }

  // A payment is simply a credit. It may make the signed vendor balance negative.
  const advancePortion = 0;

  const session = await mongoose.startSession();
  let result: VendorPaymentPayload;
  try {
    await session.withTransaction(async () => {
      const [payment] = await VendorPayment.create(
        [
          {
            vendorId,
            date: input.date,
            amount: input.amount,
            paymentMethod: input.paymentMethod,
            source,
            advancePortion,
            targetEntryId,
            referenceId: input.referenceId?.trim() || undefined,
            remarks: input.remarks?.trim() || undefined,
          },
        ],
        { session }
      );

      await Vendor.findByIdAndUpdate(
        vendorId,
        { $inc: { totalPaid: input.amount, remaining: -input.amount } },
        { session }
      );

      result = toPayload(payment);
    });
  } finally {
    session.endSession();
  }

  const actorUser = await User.findById(actor.userId).lean();
  const role = roleDisplay[actor.role as keyof typeof roleDisplay] ?? actor.role;
  await logAudit({
    userId: actor.userId,
    userName: actorUser?.name ?? "Unknown",
    userEmail: actor.email,
    role,
    action: "create",
    module: "vendor_payments",
    entityId: result!.id,
    projectId: vendor.projectId?.toString(),
    projectName: await getProjectName(vendor.projectId?.toString()),
    description: `Recorded payment: ${vendor.name} — ${input.amount.toLocaleString()} PKR`,
    newValue: { amount: input.amount, vendorId, date: input.date },
  });

  return result!;
}

export async function deleteVendorPayment(
  actor: { userId: string; email: string; role: string },
  id: string
): Promise<void> {
  if (!mongoose.Types.ObjectId.isValid(id)) throw new Error("Invalid payment ID");

  const existing = await VendorPayment.findById(id).lean();
  if (!existing) throw new Error("Payment not found");

  const vendor = await Vendor.findById(existing.vendorId).lean();
  if (!vendor) throw new Error("Vendor not found");

  const source = existing.source ?? "external";
  if (source === "advance") {
    // Reversing an advance-release just gives the balance and the due back.
  } else if ((existing.advancePortion ?? 0) > vendor.advanceBalance) {
    // This payment's advance portion has since been spent (via an "Apply Advance" payment) —
    // reversing it now would push advanceBalance negative.
    throw new Error(
      `Cannot delete this payment: ${(existing.advancePortion ?? 0).toLocaleString()} of the advance it generated has already been applied elsewhere. Reverse those first.`
    );
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      if (source === "advance") {
        await Vendor.findByIdAndUpdate(
          existing.vendorId,
          {
            $inc: {
              remaining: existing.amount,
              advanceBalance: existing.amount,
            },
          },
          { session }
        );
      } else {
        await Vendor.findByIdAndUpdate(
          existing.vendorId,
          {
            $inc: {
              totalPaid: -existing.amount,
              remaining: existing.amount,
              advanceBalance: -(existing.advancePortion ?? 0),
            },
          },
          { session }
        );
      }

      // Invoice-originated payments are their own ledger row. Reversing one restores the
      // linked consumable bill's paid/pending summary as well as the vendor balance.
      if (source !== "advance" && existing.targetEntryId) {
        const entry = await ItemLedgerEntry.findById(existing.targetEntryId).session(session).lean();
        if (entry) {
          await ConsumableItem.findByIdAndUpdate(
            entry.itemId,
            {
              $inc: {
                totalPaid: -existing.amount,
                totalPending: entry.totalPrice,
              },
            },
            { session }
          );
        }
      }
      await VendorPayment.findByIdAndDelete(id, { session });
    });
  } finally {
    session.endSession();
  }

  const actorUser = await User.findById(actor.userId).lean();
  const role = roleDisplay[actor.role as keyof typeof roleDisplay] ?? actor.role;
  await logAudit({
    userId: actor.userId,
    userName: actorUser?.name ?? "Unknown",
    userEmail: actor.email,
    role,
    action: "delete",
    module: "vendor_payments",
    entityId: id,
    projectId: vendor?.projectId?.toString(),
    projectName: await getProjectName(vendor?.projectId?.toString()),
    description: `Deleted payment: ${existing.amount.toLocaleString()} PKR`,
    oldValue: { amount: existing.amount, date: existing.date },
  });
}
