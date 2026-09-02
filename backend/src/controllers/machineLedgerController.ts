import { Response } from "express";
import {
  getMachineLedger,
  createMachineEntry,
  createMachinePayment,
  deleteMachineEntry,
  deleteMachinePayment,
  type CreateMachineEntryInput,
  type CreateMachinePaymentInput,
} from "../services/machineLedgerService.js";
import type { AuthRequest } from "../middleware/auth.js";

export async function getLedger(req: AuthRequest, res: Response) {
  try {
    const { machineId } = req.params;
    const page = req.query.page !== undefined ? Number(req.query.page) : undefined;
    const pageSize = req.query.pageSize !== undefined ? Number(req.query.pageSize) : undefined;
    const startDate = typeof req.query.startDate === "string" ? req.query.startDate : undefined;
    const endDate = typeof req.query.endDate === "string" ? req.query.endDate : undefined;
    const data = await getMachineLedger(machineId, { page, pageSize, startDate, endDate });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to get machine ledger" });
  }
}

export async function createEntry(req: AuthRequest, res: Response) {
  try {
    const actor = req.user!;
    const { machineId } = req.params;
    const body = req.body as Omit<CreateMachineEntryInput, "machineId">;
    const input: CreateMachineEntryInput = { ...body, machineId };
    const entry = await createMachineEntry(
      { userId: actor.userId, email: actor.email, role: actor.role },
      input
    );
    res.status(201).json(entry);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to add machine ledger entry";
    const status =
      msg.includes("required") || msg.includes("positive") || msg.includes("Invalid") ? 400
        : msg.includes("Insufficient stock") || msg.includes("Diesel") ? 400
        : msg.includes("not found") ? 404
        : 500;
    res.status(status).json({ error: msg });
  }
}

export async function createPayment(req: AuthRequest, res: Response) {
  try {
    const actor = req.user!;
    const { machineId } = req.params;
    const payment = await createMachinePayment(
      { userId: actor.userId, email: actor.email, role: actor.role },
      machineId,
      req.body as CreateMachinePaymentInput
    );
    res.status(201).json(payment);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to record machine payment";
    const status =
      msg.includes("required") || msg.includes("positive") || msg.includes("Invalid") || msg.includes("overpay") ? 400
        : msg.includes("not found") ? 404
        : 500;
    res.status(status).json({ error: msg });
  }
}

export async function deleteEntry(req: AuthRequest, res: Response) {
  try {
    const actor = req.user!;
    await deleteMachineEntry(
      { userId: actor.userId, email: actor.email, role: actor.role },
      req.params.entryId
    );
    res.status(204).send();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to delete ledger entry";
    const status =
      msg.includes("not found") ? 404
        : msg.includes("overpayment") || msg.includes("Cannot delete") ? 400
        : 500;
    res.status(status).json({ error: msg });
  }
}

export async function deletePayment(req: AuthRequest, res: Response) {
  try {
    const actor = req.user!;
    await deleteMachinePayment(
      { userId: actor.userId, email: actor.email, role: actor.role },
      req.params.paymentId
    );
    res.status(204).send();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to delete payment";
    const status = msg.includes("not found") ? 404 : 500;
    res.status(status).json({ error: msg });
  }
}
