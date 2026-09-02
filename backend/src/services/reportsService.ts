import mongoose from "mongoose";
import { Machine } from "../models/Machine.js";
import { MachineLedgerEntry } from "../models/MachineLedgerEntry.js";
import { StockConsumptionEntry } from "../models/StockConsumptionEntry.js";
import { ConsumableItem } from "../models/ConsumableItem.js";
import { ItemLedgerEntry } from "../models/ItemLedgerEntry.js";
import { Project } from "../models/Project.js";
import { resolveSiteManagerProjectId } from "./projectAccessService.js";
import { findDieselItem } from "./dieselService.js";

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

function todayPKT() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export async function getDailyProgressReport(
  actor: { userId: string; role: string }, projectIdParam?: string, dateParam?: string
) {
  let projectId = projectIdParam;
  if (actor.role === "site_manager") projectId = await resolveSiteManagerProjectId(actor.userId, projectIdParam);
  if (!projectId || !mongoose.Types.ObjectId.isValid(projectId)) throw new Error("Project is required");
  const date = dateParam?.trim() || todayPKT();
  if (!YMD_RE.test(date)) throw new Error("date must be YYYY-MM-DD");
  const monthStart = `${date.slice(0, 8)}01`;
  const projectObjId = new mongoose.Types.ObjectId(projectId);
  const [project, machines, dieselItem, items] = await Promise.all([
    Project.findById(projectObjId).select("name").lean(),
    Machine.find({ projectId: projectObjId }).sort({ name: 1 }).lean(),
    findDieselItem(projectId),
    ConsumableItem.find({ projectId: projectObjId }).sort({ name: 1 }).lean(),
  ]);
  if (!project) throw new Error("Project not found");
  const bucket = {
    $switch: { branches: [
      { case: { $eq: ["$date", date] }, then: "current" },
      { case: { $and: [{ $gte: ["$date", monthStart] }, { $lt: ["$date", date] }] }, then: "previous" },
    ], default: "ignore" },
  };
  const [hourBuckets, dieselBuckets, materialBuckets] = await Promise.all([
    MachineLedgerEntry.aggregate<{ _id: { machineId: mongoose.Types.ObjectId; bucket: string }; value: number }>([
      { $match: { projectId: projectObjId, date: { $gte: monthStart, $lte: date } } },
      { $addFields: { bucket } }, { $match: { bucket: { $ne: "ignore" } } },
      { $group: { _id: { machineId: "$machineId", bucket: "$bucket" }, value: { $sum: "$hoursWorked" } } },
    ]),
    StockConsumptionEntry.aggregate<{ _id: { machineId: mongoose.Types.ObjectId; bucket: string }; value: number }>([
      { $match: { projectId: projectObjId, machineId: { $exists: true }, date: { $gte: monthStart, $lte: date } } },
      { $unwind: "$items" }, { $addFields: { bucket } }, { $match: { bucket: { $ne: "ignore" } } },
      { $group: { _id: { machineId: "$machineId", bucket: "$bucket" }, value: { $sum: "$items.quantityUsed" } } },
    ]),
    ItemLedgerEntry.aggregate<{ _id: { itemId: mongoose.Types.ObjectId; bucket: string }; value: number }>([
      { $match: { projectId: projectObjId, date: { $lte: date } } },
      { $addFields: { bucket: { $cond: [{ $eq: ["$date", date] }, "current", "previous"] } } },
      { $group: { _id: { itemId: "$itemId", bucket: "$bucket" }, value: { $sum: "$quantity" } } },
    ]),
  ]);
  const hours = new Map(hourBuckets.map((r) => [`${r._id.machineId}:${r._id.bucket}`, r.value]));
  const diesels = new Map(dieselBuckets.map((r) => [`${r._id.machineId}:${r._id.bucket}`, r.value]));
  const machineryRows = machines.map((machine) => {
    const id = machine._id.toString();
    const currentHour = hours.get(`${id}:current`) ?? 0;
    const previousHour = hours.get(`${id}:previous`) ?? 0;
    const currentDiesel = diesels.get(`${id}:current`) ?? 0;
    const previousDiesel = diesels.get(`${id}:previous`) ?? 0;
    const totalHour = currentHour + previousHour;
    const totalDiesel = currentDiesel + previousDiesel;
    return { machineId: id, name: machine.name, currentDiesel, previousDiesel, totalDiesel,
      currentHour, previousHour, totalHour, avg: totalHour > 0 ? totalDiesel / totalHour : 0 };
  });
  const material = new Map(materialBuckets.map((r) => [`${r._id.itemId}:${r._id.bucket}`, r.value]));
  const materialRows = items.map((item) => {
    const id = item._id.toString();
    const current = material.get(`${id}:current`) ?? 0;
    const previous = material.get(`${id}:previous`) ?? 0;
    return { itemId: id, name: item.name, current, previous, total: current + previous };
  });
  let dieselTank = null;
  if (dieselItem) {
    const [receivedRows, issueRows] = await Promise.all([
      ItemLedgerEntry.aggregate<{ _id: string; value: number }>([
        { $match: { itemId: dieselItem._id, date: { $lte: date } } },
        { $group: { _id: { $cond: [{ $eq: ["$date", date] }, "current", "previous"] }, value: { $sum: "$quantity" } } },
      ]),
      StockConsumptionEntry.aggregate<{ _id: string; value: number }>([
        { $match: { projectId: projectObjId, "items.itemId": dieselItem._id, date: { $lt: date } } },
        { $unwind: "$items" }, { $match: { "items.itemId": dieselItem._id } },
        { $group: { _id: "previous", value: { $sum: "$items.quantityUsed" } } },
      ]),
    ]);
    const received = receivedRows.find((r) => r._id === "current")?.value ?? 0;
    const previousReceived = receivedRows.find((r) => r._id === "previous")?.value ?? 0;
    const issue = machineryRows.reduce((sum, row) => sum + row.currentDiesel, 0);
    const pIssue = issueRows[0]?.value ?? 0;
    dieselTank = { received, previousReceived, totalReceived: received + previousReceived,
      issue, pIssue, totalIssue: issue + pIssue, balance: received + previousReceived - issue - pIssue };
  }
  return { projectId, projectName: project.name, date, monthStart,
    machinery: { rows: machineryRows, dieselTank }, material: { rows: materialRows } };
}
