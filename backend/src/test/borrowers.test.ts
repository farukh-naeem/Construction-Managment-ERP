// Never load dotenv or accept an external database URI in this suite.
import assert from "node:assert/strict";
import { before, after, beforeEach, test, mock } from "node:test";
import type { Server } from "node:http";
import express from "express";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server-core";
import { Borrower } from "../models/Borrower.js";
import { BankAccount } from "../models/BankAccount.js";
import { BankTransaction } from "../models/BankTransaction.js";
import { AuditLog } from "../models/AuditLog.js";
import { User } from "../models/User.js";
import { Project } from "../models/Project.js";
import { Client } from "../models/Client.js";
import { CustomHead } from "../models/CustomHead.js";
import { borrowerRoutes } from "../routes/borrowers.js";
import { bankTransactionRoutes } from "../routes/bankTransactions.js";
import { createBorrower, deleteBorrower, updateBorrower, listBorrowers, getBorrowerLedger, minorUnits } from "../services/borrowerService.js";
import { createBankTransaction, updateBankTransaction, deleteBankTransaction, getBankAccountLedger, listBankTransactions } from "../services/bankTransactionService.js";
import { deleteBankAccount } from "../services/bankAccountService.js";

let replica: MongoMemoryReplSet;
let server: Server;
let base: string;
const actor = { userId: new mongoose.Types.ObjectId().toString(), email: "test@example.com", role: "super_admin" };
const models = [Borrower, BankTransaction, BankAccount, AuditLog, User, Project, Client, CustomHead];
before(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, dbName: "borrower-isolated-tests" } });
  await mongoose.connect(replica.getUri(), { dbName: "borrower-isolated-tests" });
  await Promise.all(models.map((model) => model.init()));
  const app = express(); app.use(express.json());
  app.use("/api/borrowers", borrowerRoutes); app.use("/api/bank-transactions", bankTransactionRoutes);
  server = await new Promise<Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}, { timeout: 180_000 });
after(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  await mongoose.disconnect();
  if (replica) await replica.stop();
});
beforeEach(async () => { for (const model of models) await model.collection.deleteMany({}); });
async function bank(balance = 1000, name = "Bank A") {
  return BankAccount.create({ name, openingBalance: balance, currentBalance: balance, totalInflow: 0, totalOutflow: 0 });
}
async function transaction(borrowerId: string, accountId: string, type: "inflow" | "outflow", amount: number, date = "2026-10-11") {
  return createBankTransaction(actor, { borrowerId, accountId, type, amount, date, source: "ignored", destination: "ignored", referenceId: "REF-1", remarks: "test" });
}
async function request(path: string, method = "GET", body?: object, role = "super_admin") {
  const token = jwt.sign({ ...actor, role }, process.env.JWT_SECRET ?? "fallback-dev-secret");
  return fetch(base + path, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
}

test("multiple banks share canonical loans, repayments and filtered running balances", async () => {
  const b = await createBorrower(actor, "Ali"); const a = await bank(); const c = await bank(1000, "Bank B");
  const loan = await transaction(b.id, String(a._id), "outflow", 100, "2026-10-01");
  await transaction(b.id, String(c._id), "outflow", 50, "2026-10-02");
  await transaction(b.id, String(c._id), "inflow", 70, "2026-10-03");
  await transaction(b.id, String(a._id), "inflow", 80, "2026-10-04");
  const ledger = await getBorrowerLedger(b.id);
  assert.deepEqual(ledger.rows.map((r) => r.balance), [100, 150, 80, 0]);
  assert.equal(ledger.totalLoaned, 150); assert.equal(ledger.totalRepaid, 150); assert.equal(ledger.outstanding, 0);
  const filtered = await getBorrowerLedger(b.id, "2026-10-03", "2026-10-03");
  assert.equal(filtered.rows[0].balance, 80); assert.equal(filtered.totalLoaned, 150);
  const bankLedger = await getBankAccountLedger(String(a._id));
  assert.equal(bankLedger.columns.at(-1)?.key, "borrower");
  assert.equal(bankLedger.rows[0].id, loan.id); assert.equal(bankLedger.rows[0].outflows.borrower, 100);
  assert.match(bankLedger.rows[0].particulars, /Ali/); assert.match(bankLedger.rows[1].particulars, /Payment received/);
  assert.equal(bankLedger.rows[1].received, 80);
  const accounts = await BankAccount.find().sort({ name: 1 }).lean();
  assert.deepEqual(accounts.map((r) => [r.currentBalance, r.totalInflow, r.totalOutflow]), [[980, 80, 100], [1020, 70, 50]]);
  const listed = await listBankTransactions(); assert.ok(listed.rows.every((r) => r.borrowerId === b.id && r.borrowerName === "Ali"));
  assert.equal(await BankTransaction.countDocuments(), 4); assert.equal(await AuditLog.countDocuments(), 5);
});

test("invalid amounts, dates, attribution and limits roll back ledger, bank, revision and audit", async () => {
  const b = await createBorrower(actor, "Ali"); const a = await bank(100);
  await transaction(b.id, String(a._id), "outflow", 40);
  const revision = (await Borrower.findById(b.id))!.revision;
  for (const [type, amount] of [["outflow", 60.01], ["inflow", 0], ["outflow", -1], ["outflow", NaN], ["outflow", Infinity], ["outflow", 0.001], ["outflow", 0.0100000001], ["outflow", Number.MAX_SAFE_INTEGER]] as const) {
    await assert.rejects(transaction(b.id, String(a._id), type, amount));
  }
  await assert.rejects(transaction(b.id, String(a._id), "inflow", 1, "2026-02-30"), /date/);
  for (const field of ["clientId", "projectId", "customHeadId", "customHeadName", "customerId"]) {
    await assert.rejects(createBankTransaction(actor, { borrowerId: b.id, accountId: String(a._id), date: "2026-10-11", type: "outflow", amount: 1, source: "a", destination: "b", [field]: "forbidden" }), /cannot be combined/);
  }
  assert.equal(await BankTransaction.countDocuments(), 1); assert.equal(await AuditLog.countDocuments(), 2);
  assert.equal((await Borrower.findById(b.id))!.revision, revision);
  assert.equal((await BankAccount.findById(a._id))!.currentBalance, 60);
});

test("cent arithmetic supports exact repayment without residual debt", async () => {
  const b = await createBorrower(actor, "Ali"); const a = await bank(0.3);
  await transaction(b.id, String(a._id), "outflow", 0.1); await transaction(b.id, String(a._id), "outflow", 0.2);
  assert.equal((await BankAccount.findById(a._id))!.currentBalance, 0);
  await transaction(b.id, String(a._id), "inflow", 0.3);
  assert.equal((await getBorrowerLedger(b.id)).outstanding, 0);
  await deleteBorrower(actor, b.id); assert.equal((await Borrower.findById(b.id))!.archived, true);
  assert.equal(minorUnits(0.29), 29);
});

test("backdated repayments and repayments above the balance produce borrower credit", async () => {
  const b = await createBorrower(actor, "Ali"); const a = await bank();
  const loan = await transaction(b.id, String(a._id), "outflow", 100, "2026-10-02");
  await transaction(b.id, String(a._id), "inflow", 150, "2026-10-01");
  await transaction(b.id, String(a._id), "inflow", 100, "2026-10-03");
  await transaction(b.id, String(a._id), "outflow", 100, "2026-10-04");
  assert.deepEqual((await getBorrowerLedger(b.id)).rows.map((r) => r.balance), [-150, -50, -150, -50]);
  await deleteBankTransaction(actor, loan.id);
  assert.equal((await getBorrowerLedger(b.id)).outstanding, -150);
  assert.equal(await BankTransaction.countDocuments(), 3);
});

test("deletion through the bank API removes both views and reverses bank totals", async () => {
  const b = await createBorrower(actor, "Ali"); const a = await bank();
  const loan = await transaction(b.id, String(a._id), "outflow", 100);
  const repayment = await transaction(b.id, String(a._id), "inflow", 40);
  assert.equal((await request(`/api/bank-transactions/${repayment.id}`, "DELETE")).status, 204);
  assert.deepEqual((await getBorrowerLedger(b.id)).rows.map((r) => r.id), [loan.id]);
  assert.deepEqual((await getBankAccountLedger(String(a._id))).rows.map((r) => r.id), [loan.id]);
  await deleteBankTransaction(actor, loan.id);
  assert.equal((await getBorrowerLedger(b.id)).rows.length, 0);
  const account = (await BankAccount.findById(a._id))!;
  assert.equal(account.currentBalance, 1000); assert.equal(account.totalInflow, 0); assert.equal(account.totalOutflow, 0);
});

test("repayment deletion is blocked if its money has been spent", async () => {
  const b = await createBorrower(actor, "Ali"); const a = await bank(100);
  await transaction(b.id, String(a._id), "outflow", 100);
  const repayment = await transaction(b.id, String(a._id), "inflow", 50);
  const other = await createBorrower(actor, "Other"); await transaction(other.id, String(a._id), "outflow", 50);
  await assert.rejects(deleteBankTransaction(actor, repayment.id), /bank balance negative/);
  assert.equal((await getBorrowerLedger(b.id)).outstanding, 50); assert.equal(await BankTransaction.countDocuments(), 3);
});

test("empty deletion, pending debt guard, settlement archive and reactivation", async () => {
  const empty = await createBorrower(actor, "Empty"); await deleteBorrower(actor, empty.id); assert.equal(await Borrower.findById(empty.id), null);
  const b = await createBorrower(actor, "Ali"); const a = await bank();
  await transaction(b.id, String(a._id), "outflow", 100); await assert.rejects(deleteBorrower(actor, b.id), /still owed/);
  const paid = await transaction(b.id, String(a._id), "inflow", 100); await deleteBorrower(actor, b.id);
  assert.equal((await listBorrowers()).length, 0); assert.equal((await listBorrowers(true))[0].id, b.id);
  assert.equal((await getBorrowerLedger(b.id)).rows.length, 2);
  await assert.rejects(transaction(b.id, String(a._id), "outflow", 1), /Active borrower not found/);
  await deleteBankTransaction(actor, paid.id);
  assert.equal((await listBorrowers())[0].outstanding, 100); assert.equal((await Borrower.findById(b.id))!.archived, false);
});

test("renames preserve historical names and normalized duplicates are rejected", async () => {
  const b = await createBorrower(actor, "Ali"); const a = await bank(); await transaction(b.id, String(a._id), "outflow", 10);
  await updateBorrower(actor, b.id, "Ali New");
  assert.equal((await getBorrowerLedger(b.id)).borrowerName, "Ali New");
  assert.equal((await getBorrowerLedger(b.id)).rows[0].borrowerName, "Ali");
  await assert.rejects(createBorrower(actor, "  ALI   NEW  "), /already exists/);
});

test("simultaneous repayments into different banks cannot overpay", async () => {
  const b = await createBorrower(actor, "Ali"); const a = await bank(); const c = await bank(0, "Bank B");
  await transaction(b.id, String(a._id), "outflow", 100);
  const outcomes = await Promise.allSettled([transaction(b.id, String(a._id), "inflow", 60), transaction(b.id, String(c._id), "inflow", 60)]);
  assert.equal(outcomes.filter((o) => o.status === "fulfilled").length, 1);
  assert.equal((await getBorrowerLedger(b.id)).outstanding, 40);
  assert.equal(await BankTransaction.countDocuments({ type: "inflow" }), 1);
});

test("simultaneous loans to different borrowers cannot overspend a bank", async () => {
  const b = await createBorrower(actor, "Ali"); const c = await createBorrower(actor, "Other"); const a = await bank(100);
  const outcomes = await Promise.allSettled([transaction(b.id, String(a._id), "outflow", 60), transaction(c.id, String(a._id), "outflow", 60)]);
  assert.equal(outcomes.filter((o) => o.status === "fulfilled").length, 1);
  assert.equal((await BankAccount.findById(a._id))!.currentBalance, 40); assert.equal(await BankTransaction.countDocuments(), 1);
});

test("borrower loans and legacy outflows contend safely for the same bank", async () => {
  const b = await createBorrower(actor, "Ali"); const a = await bank(100);
  const outcomes = await Promise.allSettled([
    transaction(b.id, String(a._id), "outflow", 60),
    createBankTransaction(actor, { accountId: String(a._id), date: "2026-10-11", type: "outflow", amount: 60, source: "Bank A", destination: "Legacy" }),
  ]);
  assert.equal(outcomes.filter((o) => o.status === "fulfilled").length, 1);
  assert.equal((await BankAccount.findById(a._id))!.currentBalance, 40);
  assert.equal(await BankTransaction.countDocuments(), 1);
});

test("bank account deletion cannot orphan a loan recorded after the entry count check", async () => {
  const b = await createBorrower(actor, "Ali"); const a = await bank(100);
  // Reproduce a stale count of zero, then commit the loan before deletion runs.
  const count = mock.method(BankTransaction, "countDocuments", async () => {
    await transaction(b.id, String(a._id), "outflow", 60);
    return 0;
  });
  try { await assert.rejects(deleteBankAccount(actor, String(a._id)), /account changed/); }
  finally { count.mock.restore(); }
  assert.equal((await BankAccount.findById(a._id))!.currentBalance, 40);
  assert.equal((await getBorrowerLedger(b.id)).outstanding, 60);
  await assert.rejects(deleteBankAccount(actor, String(a._id)), /linked to this account/);
  const empty = await bank(0, "Empty");
  await deleteBankAccount(actor, String(empty._id));
  assert.equal(await BankAccount.findById(empty._id), null);
});

test("an audit write failure rolls back the payment and every associated balance", async () => {
  const b = await createBorrower(actor, "Ali"); const a = await bank();
  const before = (await Borrower.findById(b.id))!.revision;
  await assert.rejects(createBankTransaction({ ...actor, email: "" }, { borrowerId: b.id, accountId: String(a._id), date: "2026-10-11", type: "outflow", amount: 10, source: "a", destination: "b" }));
  assert.equal(await BankTransaction.countDocuments(), 0);
  assert.equal((await BankAccount.findById(a._id))!.currentBalance, 1000);
  assert.equal((await Borrower.findById(b.id))!.revision, before);
  assert.equal(await AuditLog.countDocuments(), 1);
});

test("simultaneous archive and new loan never hides pending debt", async () => {
  const b = await createBorrower(actor, "Ali"); const a = await bank();
  await transaction(b.id, String(a._id), "outflow", 100); await transaction(b.id, String(a._id), "inflow", 100);
  const outcomes = await Promise.allSettled([deleteBorrower(actor, b.id), transaction(b.id, String(a._id), "outflow", 50)]);
  assert.equal(outcomes.filter((o) => o.status === "fulfilled").length, 1);
  const ledger = await getBorrowerLedger(b.id); assert.ok(!ledger.archived || ledger.outstanding === 0);
});

test("API enforces role permissions and immutable borrower payments", async () => {
  const response = await request("/api/borrowers", "POST", { name: "Ali" }, "admin"); assert.equal(response.status, 201);
  const b = await response.json() as { id: string }; const a = await bank(); const loan = await transaction(b.id, String(a._id), "outflow", 10);
  for (const role of ["admin", "site_manager"]) {
    assert.equal((await request(`/api/bank-transactions/${loan.id}`, "DELETE", undefined, role)).status, 403);
    assert.equal((await request(`/api/borrowers/${b.id}`, "DELETE", undefined, role)).status, 403);
  }
  assert.equal((await request("/api/borrowers", "GET", undefined, "site_manager")).status, 403);
  assert.equal((await request(`/api/bank-transactions/${loan.id}`, "PATCH", { amount: 5 })).status, 400);
  const ordinary = await createBankTransaction(actor, { accountId: String(a._id), date: "2026-10-11", type: "inflow", amount: 5, source: "Owner", destination: "Bank A" });
  assert.equal((await request(`/api/bank-transactions/${ordinary.id}`, "PATCH", { borrowerId: b.id })).status, 400);
  assert.equal((await request("/api/bank-transactions", "POST", { borrowerId: b.id, accountId: String(a._id), type: "inflow", amount: 11, date: "2026-10-11" }, "admin")).status, 400);
});

test("existing client, head, project and customer transaction behavior is retained", async () => {
  const a = await bank(); const client = await Client.create({ name: "Client", normalizedName: "client" }); const project = await Project.create({ name: "Project", allocatedBudget: 1000 });
  const received = await createBankTransaction(actor, { accountId: String(a._id), date: "2026-10-01", type: "inflow", amount: 100, source: "Client", destination: "Bank A", clientId: String(client._id), projectId: String(project._id) });
  assert.equal((await Project.findById(project._id))!.balance, 0);
  const funded = await createBankTransaction(actor, { accountId: String(a._id), date: "2026-10-02", type: "outflow", amount: 200, source: "Bank A", destination: "Project", projectId: String(project._id) });
  assert.equal((await Project.findById(project._id))!.balance, 200);
  const head = await createBankTransaction(actor, { accountId: String(a._id), date: "2026-10-03", type: "outflow", amount: 10, source: "Bank A", destination: "Rent", customHeadName: "Rent" });
  await updateBankTransaction(actor, received.id, { amount: 110 });
  const ledger = await getBankAccountLedger(String(a._id)); assert.ok(!ledger.columns.some((c) => c.key === "borrower")); assert.equal(ledger.rows.at(-1)!.balance, 900);
  const b = await createBorrower(actor, "Ali"); await transaction(b.id, String(a._id), "outflow", 10);
  const mixed = await getBankAccountLedger(String(a._id)); assert.equal(mixed.columns.at(-1)?.key, "borrower"); assert.equal(mixed.columns[0].kind, "project");
  await deleteBankTransaction(actor, head.id); await deleteBankTransaction(actor, funded.id); assert.equal((await Project.findById(project._id))!.balance, 0);
  const protectedTx = await BankTransaction.create({ accountId: a._id, customerId: new mongoose.Types.ObjectId(), date: "2026-10-11", type: "inflow", amount: 5, source: "Customer", destination: "Bank A", mode: "Bank" });
  await assert.rejects(updateBankTransaction(actor, String(protectedTx._id), { amount: 6 }), /customer payment/);
  await assert.rejects(deleteBankTransaction(actor, String(protectedTx._id)), /customer payment/);
});
