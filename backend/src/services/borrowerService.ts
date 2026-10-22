import mongoose, { type ClientSession } from "mongoose";
import { Borrower } from "../models/Borrower.js";
import { BankTransaction } from "../models/BankTransaction.js";
import { User } from "../models/User.js";
import { logAudit } from "./auditService.js";
import { roleDisplay } from "./authService.js";

export type BorrowerActor = { userId: string; email: string; role: string };
export class BorrowerError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export function requireBorrowerAccess(actor: BorrowerActor, deleting = false) {
  if (actor.role !== "super_admin" && (deleting || actor.role !== "admin")) {
    throw new BorrowerError(deleting ? "Forbidden: deletion requires Super Admin" : "Forbidden: borrower access requires Admin or Super Admin", 403);
  }
}
export function borrowerObjectId(value: string, label: string) {
  if (!mongoose.Types.ObjectId.isValid(value)) throw new BorrowerError(`Invalid ${label} ID`);
  return new mongoose.Types.ObjectId(value);
}
export function minorUnits(value: number): number {
  const scaled = value * 100;
  const rounded = Math.round(scaled);
  // Permit floating point representation noise, never fractions of a currency cent.
  if (!Number.isFinite(value) || !Number.isSafeInteger(rounded) || Math.abs(scaled - rounded) > Math.min(0.001, Math.max(1e-7, Math.abs(scaled) * Number.EPSILON * 2))) {
    throw new BorrowerError("Invalid amount: use at most two decimal places within the supported range");
  }
  return rounded;
}
function safeAdd(a: number, b: number) {
  const result = a + b;
  if (!Number.isSafeInteger(result)) throw new BorrowerError("Invalid amount: ledger exceeds the supported range");
  return result;
}
export interface LoanRow { type: "inflow" | "outflow"; amount: number }
export function borrowerTotals(rows: LoanRow[]) {
  let loaned = 0; let repaid = 0; let balance = 0;
  const balances = rows.map((row) => {
    const amount = minorUnits(row.amount);
    if (row.type === "outflow") loaned = safeAdd(loaned, amount);
    else repaid = safeAdd(repaid, amount);
    balance = safeAdd(balance, row.type === "outflow" ? amount : -amount);
    return balance / 100;
  });
  return { totalLoaned: loaned / 100, totalRepaid: repaid / 100, outstanding: balance / 100, balances };
}
export async function loanHistory(id: mongoose.Types.ObjectId, session: ClientSession) {
  return BankTransaction.find({ borrowerId: id }).select("type amount date createdAt").sort({ date: 1, createdAt: 1, _id: 1 }).session(session).lean();
}
export async function borrowerAudit(actor: BorrowerActor, session: ClientSession, data: {
  action: "create" | "update" | "delete"; module: string; entityId: string; description: string; oldValue?: object; newValue?: object;
}) {
  const user = await User.findById(actor.userId).session(session).lean();
  await logAudit({ ...data, userId: actor.userId, userName: user?.name ?? "Unknown", userEmail: actor.email, role: roleDisplay[actor.role as keyof typeof roleDisplay] ?? actor.role }, session);
}
function cleanName(name: string) {
  if (typeof name !== "string" || !name.trim()) throw new BorrowerError("Borrower name is required");
  return name.trim().replace(/\s+/g, " ");
}
function duplicateError(err: unknown): never {
  if ((err as { code?: number })?.code === 11000) throw new BorrowerError("A borrower with this name already exists", 409);
  throw err;
}
export interface BorrowerPayload { id: string; name: string; archived: boolean; totalLoaned: number; totalRepaid: number; outstanding: number }
export async function listBorrowers(archived = false): Promise<BorrowerPayload[]> {
  // One snapshot keeps borrower state and totals consistent during concurrent mutations.
  return mongoose.connection.transaction(async (session) => {
    const borrowers = await Borrower.find({ archived }).sort({ name: 1 }).session(session).lean();
    const ids = borrowers.map((b) => b._id);
    // Aggregate minor units in MongoDB rather than transferring every loan into
    // memory whenever the active list or bank transaction dropdown is refreshed.
    const summaries = await BankTransaction.aggregate<{ _id: mongoose.Types.ObjectId; loaned: number; repaid: number }>([
      { $match: { borrowerId: { $in: ids } } },
      { $group: {
        _id: "$borrowerId",
        loaned: { $sum: { $cond: [{ $eq: ["$type", "outflow"] }, { $round: [{ $multiply: ["$amount", 100] }, 0] }, 0] } },
        repaid: { $sum: { $cond: [{ $eq: ["$type", "inflow"] }, { $round: [{ $multiply: ["$amount", 100] }, 0] }, 0] } },
      } },
    ]).session(session);
    const grouped = new Map(summaries.map((row) => [String(row._id), row]));
    return borrowers.map((b) => {
      const totals = grouped.get(String(b._id));
      const loaned = totals?.loaned ?? 0; const repaid = totals?.repaid ?? 0;
      if (!Number.isSafeInteger(loaned) || !Number.isSafeInteger(repaid)) throw new BorrowerError("Invalid amount: ledger exceeds the supported range");
      return { id: String(b._id), name: b.name, archived: b.archived, totalLoaned: loaned / 100, totalRepaid: repaid / 100, outstanding: (loaned - repaid) / 100 };
    });
  }, { readConcern: { level: "snapshot" } });
}
export async function createBorrower(actor: BorrowerActor, name: string) {
  requireBorrowerAccess(actor);
  const cleaned = cleanName(name);
  try {
    return await mongoose.connection.transaction(async (session) => {
      const [borrower] = await Borrower.create([{ name: cleaned, normalizedName: cleaned.toLocaleLowerCase() }], { session });
      await borrowerAudit(actor, session, { action: "create", module: "borrowers", entityId: String(borrower._id), description: `Created borrower: ${cleaned}`, newValue: { name: cleaned } });
      return { id: String(borrower._id), name: cleaned, archived: false, totalLoaned: 0, totalRepaid: 0, outstanding: 0 };
    });
  } catch (err) { duplicateError(err); }
}
export async function updateBorrower(actor: BorrowerActor, id: string, name: string) {
  requireBorrowerAccess(actor);
  const objectId = borrowerObjectId(id, "borrower");
  const cleaned = cleanName(name);
  try {
    return await mongoose.connection.transaction(async (session) => {
      const before = await Borrower.findById(objectId).session(session).lean();
      if (!before) throw new BorrowerError("Borrower not found", 404);
      await Borrower.updateOne({ _id: objectId }, { $set: { name: cleaned, normalizedName: cleaned.toLocaleLowerCase() }, $inc: { revision: 1 } }, { session, runValidators: true });
      // Transaction source/destination are historical snapshots and are never rewritten.
      await borrowerAudit(actor, session, { action: "update", module: "borrowers", entityId: id, description: `Updated borrower: ${cleaned}`, oldValue: { name: before.name }, newValue: { name: cleaned } });
      return { id, name: cleaned, archived: before.archived };
    });
  } catch (err) { duplicateError(err); }
}
export async function deleteBorrower(actor: BorrowerActor, id: string) {
  requireBorrowerAccess(actor, true);
  const objectId = borrowerObjectId(id, "borrower");
  return mongoose.connection.transaction(async (session) => {
    // All money mutations acquire this same write before reading the ledger.
    const borrower = await Borrower.findOneAndUpdate({ _id: objectId }, { $inc: { revision: 1 } }, { session, new: true });
    if (!borrower) throw new BorrowerError("Borrower not found", 404);
    const rows = await loanHistory(objectId, session);
    if (borrowerTotals(rows).outstanding !== 0) throw new BorrowerError("Cannot delete borrower: account balance is not settled");
    if (rows.length) await Borrower.updateOne({ _id: objectId }, { $set: { archived: true } }, { session });
    else await Borrower.deleteOne({ _id: objectId }, { session });
    await borrowerAudit(actor, session, { action: "delete", module: "borrowers", entityId: id, description: `${rows.length ? "Archived" : "Deleted"} borrower: ${borrower.name}`, oldValue: { name: borrower.name }, newValue: { archived: rows.length > 0 } });
  });
}
export async function getBorrowerLedger(id: string, startDate?: string, endDate?: string) {
  const objectId = borrowerObjectId(id, "borrower");
  return mongoose.connection.transaction(async (session) => {
    const borrower = await Borrower.findById(objectId).session(session).lean();
    if (!borrower) throw new BorrowerError("Borrower not found", 404);
    const docs = await BankTransaction.find({ borrowerId: objectId }).sort({ date: 1, createdAt: 1, _id: 1 }).populate("accountId", "name").session(session).lean();
    const { balances, ...totals } = borrowerTotals(docs);
    const rows = docs.map((doc, index) => {
      const account = doc.accountId as unknown as { _id: mongoose.Types.ObjectId; name: string } | null;
      return { id: String(doc._id), date: doc.date, type: doc.type, amount: doc.amount, loanGiven: doc.type === "outflow" ? doc.amount : 0, repayment: doc.type === "inflow" ? doc.amount : 0, accountId: String(account?._id ?? ""), accountName: account?.name ?? "—", borrowerName: doc.type === "outflow" ? doc.destination : doc.source, referenceId: doc.referenceId, remarks: doc.remarks, mode: doc.mode, balance: balances[index] };
    }).filter((row) => (!startDate || row.date >= startDate) && (!endDate || row.date <= endDate));
    return { borrowerId: id, borrowerName: borrower.name, archived: borrower.archived, ...totals, rows };
  }, { readConcern: { level: "snapshot" } });
}
