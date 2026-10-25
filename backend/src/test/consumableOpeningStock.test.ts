// Always use an isolated in-memory database, never the configured application database.
import assert from "node:assert/strict";
import { before, after, beforeEach, test } from "node:test";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server-core";
import { ConsumableItem } from "../models/ConsumableItem.js";
import { ItemLedgerEntry } from "../models/ItemLedgerEntry.js";
import { StockConsumptionEntry } from "../models/StockConsumptionEntry.js";
import { AuditLog } from "../models/AuditLog.js";
import { Project } from "../models/Project.js";
import { createConsumableItem, getConsumableItemById, listConsumableItems } from "../services/consumableItemService.js";
import { createStockConsumption, updateStockConsumption, deleteStockConsumption } from "../services/stockConsumptionService.js";
import { getDailyProgressReport } from "../services/reportsService.js";

let replica: MongoMemoryReplSet;
let projectId: string;
const actor = { userId: new mongoose.Types.ObjectId().toString(), email: "test@example.com", role: "super_admin" };
before(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, dbName: "opening-stock-tests" } });
  await mongoose.connect(replica.getUri());
  await Promise.all([ConsumableItem.init(), ItemLedgerEntry.init(), StockConsumptionEntry.init()]);
}, { timeout: 180_000 });
after(async () => { await mongoose.disconnect(); if (replica) await replica.stop(); });
beforeEach(async () => {
  for (const collection of Object.values(mongoose.connection.collections)) await collection.deleteMany({});
  projectId = String((await Project.create({ name: "Ongoing since 2021", allocatedBudget: 0, startDate: "2021-01-01" }))._id);
});

test("opening stock is immediately available without purchases or financial charges", async () => {
  const item = await createConsumableItem(actor, { projectId, name: "Cement", openingStock: 120.5 });
  assert.equal(item.currentStock, 120.5);
  assert.equal(item.openingStock, 120.5);
  assert.equal(item.totalPurchased, 0);
  assert.equal(item.totalAmount, 0);
  assert.equal(item.totalPaid, 0);
  assert.equal(item.totalPending, 0);
  assert.equal((await listConsumableItems(actor, projectId))[0].currentStock, 120.5);
  assert.equal((await getConsumableItemById(item.id))?.openingStock, 120.5);
  assert.equal(await ItemLedgerEntry.countDocuments(), 0);
  const audit = await AuditLog.findOne({ entityId: item.id }).lean();
  assert.equal(JSON.parse(audit!.newValue!).openingStock, 120.5);
});

test("opening stock can be consumed, edited and restored, with overspending rejected", async () => {
  const item = await createConsumableItem(actor, { projectId, name: "Cement", openingStock: 50 });
  const entry = await createStockConsumption(actor, { projectId, date: "2026-10-26", items: [{ itemId: item.id, unit: "bag", quantityUsed: 12.5 }] });
  assert.equal((await getConsumableItemById(item.id))?.currentStock, 37.5);
  await assert.rejects(createStockConsumption(actor, { projectId, date: "2026-10-26", items: [{ itemId: item.id, unit: "bag", quantityUsed: 38 }] }), /Insufficient stock/);
  assert.equal(await StockConsumptionEntry.countDocuments(), 1);
  await updateStockConsumption(actor, entry.id, { items: [{ itemId: item.id, unit: "bag", quantityUsed: 20 }] });
  assert.equal((await getConsumableItemById(item.id))?.currentStock, 30);
  await deleteStockConsumption(actor, entry.id);
  assert.equal((await getConsumableItemById(item.id))?.currentStock, 50);
  assert.equal((await getConsumableItemById(item.id))?.openingStock, 50);
});

test("material report carries opening stock forward and adds dated purchases exactly once", async () => {
  const item = await createConsumableItem(actor, { projectId, name: "Cement", openingStock: 100 });
  const otherProject = String(new mongoose.Types.ObjectId());
  await createConsumableItem(actor, { projectId: otherProject, name: "Other cement", openingStock: 999 });
  for (const [date, quantity] of [["2026-10-25", 20], ["2026-10-26", 10], ["2026-10-27", 500]] as const) {
    await ItemLedgerEntry.create({ projectId, itemId: item.id, vendorId: new mongoose.Types.ObjectId(), date, quantity, unitPrice: 1, totalPrice: quantity, paymentMethod: "Cash" });
  }
  const report = await getDailyProgressReport(actor, projectId, "2026-10-26");
  assert.deepEqual(report.material.rows, [{ itemId: item.id, name: "Cement", previous: 120, current: 10, total: 130 }]);
});

test("diesel tank includes opening stock and deducts consumption", async () => {
  const item = await createConsumableItem(actor, { projectId, name: "Diesel", openingStock: 200 });
  await createStockConsumption(actor, { projectId, date: "2026-10-25", items: [{ itemId: item.id, unit: "litre", quantityUsed: 25 }] });
  const report = await getDailyProgressReport(actor, projectId, "2026-10-26");
  assert.equal(report.machinery.dieselTank?.previousReceived, 200);
  assert.equal(report.machinery.dieselTank?.balance, 175);
  assert.equal(report.material.rows[0].total, 200);
});

test("omitted opening stock and legacy items default to zero; invalid quantities create nothing", async () => {
  for (const value of [-1, NaN, Infinity, "20", null, Number.MAX_VALUE]) {
    await assert.rejects(createConsumableItem(actor, { projectId, name: "Invalid", openingStock: value as number }), /Opening stock/);
  }
  assert.equal(await ConsumableItem.countDocuments(), 0);
  const item = await createConsumableItem(actor, { projectId, name: "New item" });
  assert.equal(item.openingStock, 0);
  assert.equal(item.currentStock, 0);
  // Bypass schema defaults to simulate a document from before this feature.
  await ConsumableItem.collection.insertOne({ projectId: new mongoose.Types.ObjectId(projectId), name: "Legacy", currentStock: 5 });
  const legacy = (await listConsumableItems(actor, projectId)).find((i) => i.name === "Legacy")!;
  assert.equal(legacy.openingStock, 0);
  assert.equal(legacy.currentStock, 5);
  assert.equal((await getDailyProgressReport(actor, projectId, "2026-10-26")).material.rows.find((i) => i.name === "Legacy")?.total, 0);
});
