import mongoose from "mongoose";
import { Borrower } from "../models/Borrower.js";
import { BankAccount } from "../models/BankAccount.js";
import { BankTransaction } from "../models/BankTransaction.js";
import type { BankTransactionPayload, CreateBankTransactionInput } from "./bankTransactionService.js";
import { BorrowerError, borrowerAudit, borrowerObjectId, borrowerTotals, loanHistory, minorUnits, requireBorrowerAccess, type BorrowerActor } from "./borrowerService.js";

export async function createBorrowerTransaction(actor: BorrowerActor, input: CreateBankTransactionInput): Promise<BankTransactionPayload> {
  requireBorrowerAccess(actor);
  const borrowerId = borrowerObjectId(input.borrowerId!, "borrower");
  const accountId = borrowerObjectId(input.accountId, "account");
  if ([input.clientId, (input as { customerId?: string }).customerId, input.projectId, input.customHeadId, input.customHeadName].some((v) => v != null && v !== "")) {
    throw new BorrowerError("Invalid borrower transaction: client, customer, project and custom head cannot be combined with a borrower");
  }
  if (typeof input.amount !== "number" || minorUnits(input.amount) <= 0) throw new BorrowerError("Valid positive amount is required");
  if (minorUnits(input.amount) / 100 !== input.amount) throw new BorrowerError("Invalid amount: use at most two decimal places");
  if (input.type !== "inflow" && input.type !== "outflow") throw new BorrowerError("Invalid transaction type");
  const date = typeof input.date === "string" ? input.date.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new BorrowerError("Invalid transaction date");
  const mode = input.mode ?? "Bank";
  if (!["Cash", "Bank", "Online"].includes(mode)) throw new BorrowerError("Invalid mode");
  if ([input.referenceId, input.remarks].some((v) => v != null && typeof v !== "string")) throw new BorrowerError("Invalid reference or remarks");
  return mongoose.connection.transaction(async (session) => {
    const borrower = await Borrower.findOneAndUpdate({ _id: borrowerId, archived: false }, { $inc: { revision: 1 } }, { session, new: true });
    if (!borrower) throw new BorrowerError("Active borrower not found", 404);
    const account = await BankAccount.findById(accountId).session(session).lean();
    if (!account) throw new BorrowerError("Account not found", 404);
    const amount = minorUnits(input.amount) / 100;
    const delta = input.type === "inflow" ? amount : -amount;
    const nextBalance = minorUnits(account.currentBalance) + minorUnits(delta);
    const nextTotal = minorUnits(input.type === "inflow" ? account.totalInflow : account.totalOutflow) + minorUnits(amount);
    if (!Number.isSafeInteger(nextBalance) || !Number.isSafeInteger(nextTotal)) throw new BorrowerError("Invalid amount: bank balance exceeds the supported range");
    if (nextBalance < 0) throw new BorrowerError("Insufficient bank balance for this loan");
    const [tx] = await BankTransaction.create([{
      borrowerId, accountId, date, type: input.type, amount,
      source: input.type === "inflow" ? borrower.name : account.name,
      destination: input.type === "outflow" ? borrower.name : account.name,
      mode, referenceId: input.referenceId?.trim(), remarks: input.remarks?.trim(),
    }], { session });
    borrowerTotals(await loanHistory(borrowerId, session));
    const updated = await BankAccount.updateOne({ _id: accountId, currentBalance: account.currentBalance }, {
      $set: { currentBalance: nextBalance / 100, [input.type === "inflow" ? "totalInflow" : "totalOutflow"]: nextTotal / 100 },
    }, { session });
    if (updated.matchedCount !== 1) throw new BorrowerError("Bank balance changed; retry the transaction", 409);
    await borrowerAudit(actor, session, { action: "create", module: "bank_transactions", entityId: String(tx._id), description: `${input.type === "outflow" ? "Payment given" : "Payment received"}: ${amount} — ${borrower.name}`, newValue: { borrowerId: String(borrowerId), accountId: String(accountId), type: tx.type, amount } });
    return { id: String(tx._id), borrowerId: String(borrowerId), borrowerName: borrower.name, accountId: String(accountId), accountName: account.name, date, type: tx.type, amount, source: tx.source, destination: tx.destination, mode: tx.mode, referenceId: tx.referenceId, remarks: tx.remarks };
  }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
}

export async function deleteBorrowerTransaction(actor: BorrowerActor, id: string): Promise<void> {
  requireBorrowerAccess(actor, true);
  const transactionId = borrowerObjectId(id, "transaction");
  await mongoose.connection.transaction(async (session) => {
    const tx = await BankTransaction.findById(transactionId).session(session).lean();
    if (!tx) throw new BorrowerError("Transaction not found", 404);
    if (!tx.borrowerId) throw new BorrowerError("Invalid borrower transaction");
    const borrower = await Borrower.findOneAndUpdate({ _id: tx.borrowerId }, { $inc: { revision: 1 } }, { session, new: true });
    if (!borrower) throw new BorrowerError("Borrower not found", 404);
    const account = await BankAccount.findById(tx.accountId).session(session).lean();
    if (!account) throw new BorrowerError("Account not found", 404);
    await BankTransaction.deleteOne({ _id: transactionId }, { session });
    const totals = borrowerTotals(await loanHistory(tx.borrowerId, session));
    const nextBalance = minorUnits(account.currentBalance) + (tx.type === "inflow" ? -minorUnits(tx.amount) : minorUnits(tx.amount));
    const nextTotal = minorUnits(tx.type === "inflow" ? account.totalInflow : account.totalOutflow) - minorUnits(tx.amount);
    if (!Number.isSafeInteger(nextBalance) || !Number.isSafeInteger(nextTotal)) throw new BorrowerError("Invalid amount: bank balance exceeds the supported range");
    if (nextBalance < 0) throw new BorrowerError("Cannot delete: reversing this repayment would make bank balance negative");
    if (nextTotal < 0) throw new BorrowerError("Cannot delete: bank totals are inconsistent");
    const updated = await BankAccount.updateOne({ _id: tx.accountId, currentBalance: account.currentBalance }, {
      $set: { currentBalance: nextBalance / 100, [tx.type === "inflow" ? "totalInflow" : "totalOutflow"]: nextTotal / 100 },
    }, { session });
    if (updated.matchedCount !== 1) throw new BorrowerError("Bank balance changed; retry the transaction", 409);
    if (borrower.archived && totals.outstanding !== 0) await Borrower.updateOne({ _id: borrower._id }, { $set: { archived: false } }, { session });
    await borrowerAudit(actor, session, { action: "delete", module: "bank_transactions", entityId: id, description: `Deleted ${tx.type === "outflow" ? "payment given" : "payment received"}: ${tx.amount} — ${borrower.name}`, oldValue: { borrowerId: String(tx.borrowerId), accountId: String(tx.accountId), type: tx.type, amount: tx.amount }, newValue: { outstanding: totals.outstanding, reactivated: borrower.archived && totals.outstanding !== 0 } });
  }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
}
