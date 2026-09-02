import "dotenv/config";
import mongoose from "mongoose";
import { Project } from "../models/Project.js";
import { Contractor } from "../models/Contractor.js";
import { ContractorEntry } from "../models/ContractorEntry.js";
import { ContractorPayment } from "../models/ContractorPayment.js";
import { ContractorPaymentAllocation } from "../models/ContractorPaymentAllocation.js";
import { rebuildContractorPaymentAllocations } from "../services/contractorPaymentAllocationService.js";
import { getContractorLedger } from "../services/contractorLedgerService.js";
import { Machine } from "../models/Machine.js";
import { MachineLedgerEntry } from "../models/MachineLedgerEntry.js";
import { StockConsumptionEntry } from "../models/StockConsumptionEntry.js";
import { ConsumableItem } from "../models/ConsumableItem.js";
import { AuditLog } from "../models/AuditLog.js";
import { createMachineEntry, deleteMachineEntry } from "../services/machineLedgerService.js";

const MONGODB_URI = process.env.MONGODB_URI ?? "mongodb://localhost:27017/builderp-test";

function assertCondition(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(`Integrity test failed: ${message}`);
  }
}

async function testContractorFifoAcrossMonths() {
  console.log("Running contractor FIFO allocation test...");

  // Create an isolated test project.
  const project = await Project.create({
    name: "FIFO Test Project",
    description: "Temporary project for contractor FIFO integrity test",
    allocatedBudget: 0,
    status: "active",
    startDate: "2025-01-01",
    endDate: "",
    spent: 0,
  });

  try {
    // Clean any previous test data for this project/contractor name.
    await Contractor.deleteMany({ projectId: project._id, name: "FIFO Test Contractor" });

    const contractor = await Contractor.create({
      projectId: project._id,
      name: "FIFO Test Contractor",
      phone: "",
      description: "",
    });

    await ContractorEntry.deleteMany({ projectId: project._id });
    await ContractorPayment.deleteMany({ contractorId: contractor._id });
    await ContractorPaymentAllocation.deleteMany({ contractorId: contractor._id });

    // Scenario:
    // - January: one entry of 150,000.
    // - February: one payment of 150,000.
    // Expectation:
    // - January ledger shows TotalAmount=150,000, PaidAmount=150,000, Remaining=0.
    // - February ledger has no entries, so totals remain 0.

    await ContractorEntry.create({
      contractorId: contractor._id,
      projectId: project._id,
      date: "2025-01-10",
      amount: 150_000,
      remarks: "January work",
    });

    await ContractorPayment.create({
      contractorId: contractor._id,
      date: "2025-02-05",
      amount: 150_000,
      paymentMethod: "Cash",
      referenceId: "TEST-JAN-FEB",
    });

    await rebuildContractorPaymentAllocations(contractor._id.toString());

    const janLedger = await getContractorLedger(project._id.toString(), "2025-01", {
      contractorId: contractor._id.toString(),
    });

    assertCondition(
      janLedger.totalAmount === 150_000,
      `Jan totalAmount expected 150000, got ${janLedger.totalAmount}`
    );
    assertCondition(
      janLedger.totalPaid === 150_000,
      `Jan totalPaid expected 150000, got ${janLedger.totalPaid}`
    );
    assertCondition(
      janLedger.remaining === 0,
      `Jan remaining expected 0, got ${janLedger.remaining}`
    );

    const febLedger = await getContractorLedger(project._id.toString(), "2025-02", {
      contractorId: contractor._id.toString(),
    });

    assertCondition(
      febLedger.totalAmount === 0,
      `Feb totalAmount expected 0, got ${febLedger.totalAmount}`
    );
    assertCondition(
      febLedger.totalPaid === 0,
      `Feb totalPaid expected 0, got ${febLedger.totalPaid}`
    );
    assertCondition(
      febLedger.remaining === 0,
      `Feb remaining expected 0, got ${febLedger.remaining}`
    );

    console.log("Contractor FIFO allocation test passed.");
  } finally {
    // Clean up test-specific data while leaving other data untouched.
    await ContractorEntry.deleteMany({ projectId: project._id });
    await ContractorPayment.deleteMany({ contractorId: { $in: await Contractor.find({ projectId: project._id }).distinct("_id") } });
    await ContractorPaymentAllocation.deleteMany({ contractorId: { $in: await Contractor.find({ projectId: project._id }).distinct("_id") } });
    await Contractor.deleteMany({ projectId: project._id });
    await Project.findByIdAndDelete(project._id);
  }
}

async function testDeletingMachineEntryRestoresDiesel() {
  console.log("Running machine diesel reversal test...");
  const project = await Project.create({
    name: "Diesel Reversal Test Project", description: "Temporary diesel integrity test",
    allocatedBudget: 0, status: "active", startDate: "2026-09-01", endDate: "", spent: 0,
  });
  const actorId = new mongoose.Types.ObjectId().toString();
  try {
    const machine = await Machine.create({ projectId: project._id, name: "Test Excavator", ownership: "Company Owned", hourlyRate: 100 });
    const diesel = await ConsumableItem.create({
      projectId: project._id, name: "Diesel", unit: "litre", currentStock: 500,
      totalPurchased: 500, totalAmount: 0, totalPaid: 0, totalPending: 0,
    });
    const entry = await createMachineEntry(
      { userId: actorId, email: "integrity-test@example.com", role: "super_admin" },
      { machineId: machine._id.toString(), date: "2026-09-02", hoursWorked: 8, dieselLitres: 100 }
    );
    const afterCreate = await ConsumableItem.findById(diesel._id).lean();
    assertCondition(afterCreate?.currentStock === 400, `diesel stock expected 400 after entry, got ${afterCreate?.currentStock}`);
    assertCondition(await StockConsumptionEntry.exists({ machineLedgerEntryId: entry.id }), "linked diesel consumption was not created");

    await deleteMachineEntry({ userId: actorId, email: "integrity-test@example.com", role: "super_admin" }, entry.id);
    const afterDelete = await ConsumableItem.findById(diesel._id).lean();
    assertCondition(afterDelete?.currentStock === 500, `diesel stock expected 500 after deletion, got ${afterDelete?.currentStock}`);
    assertCondition(!(await StockConsumptionEntry.exists({ machineLedgerEntryId: entry.id })), "linked diesel consumption was not deleted");
    console.log("Machine diesel reversal test passed.");
  } finally {
    await StockConsumptionEntry.deleteMany({ projectId: project._id });
    await MachineLedgerEntry.deleteMany({ projectId: project._id });
    await Machine.deleteMany({ projectId: project._id });
    await ConsumableItem.deleteMany({ projectId: project._id });
    await AuditLog.deleteMany({ projectId: project._id });
    await Project.findByIdAndDelete(project._id);
  }
}

async function main() {
  console.log("Starting integrity tests...");
  await mongoose.connect(MONGODB_URI);

  try {
    await testDeletingMachineEntryRestoresDiesel();
    await testContractorFifoAcrossMonths();
    console.log("All integrity tests passed.");
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
