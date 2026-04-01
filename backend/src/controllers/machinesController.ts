import { Response } from "express";
import {
  listMachines,
  listMachinesRunningBill,
  getMachineById,
  createMachine,
  updateMachine,
  deleteMachine,
  type CreateMachineInput,
  type UpdateMachineInput,
} from "../services/machineService.js";
import type { AuthRequest } from "../middleware/auth.js";

export async function list(req: AuthRequest, res: Response) {
  try {
    const actor = req.user!;
    const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
    const page = req.query.page !== undefined ? Number(req.query.page) : undefined;
    const pageSize = req.query.pageSize !== undefined ? Number(req.query.pageSize) : undefined;
    const result = await listMachines(
      { userId: actor.userId, role: actor.role },
      { projectId, page, pageSize }
    );
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list machines";
    res.status(500).json({ error: message });
  }
}

export async function runningBillList(req: AuthRequest, res: Response) {
  try {
    const actor = req.user!;
    const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
    const periodStart = typeof req.query.periodStart === "string" ? req.query.periodStart : "";
    const periodEnd = typeof req.query.periodEnd === "string" ? req.query.periodEnd : "";
    const page = req.query.page !== undefined ? Number(req.query.page) : undefined;
    const pageSize = req.query.pageSize !== undefined ? Number(req.query.pageSize) : undefined;
    const result = await listMachinesRunningBill(
      { userId: actor.userId, role: actor.role },
      { projectId, periodStart, periodEnd, page, pageSize }
    );
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load machinery running bill";
    const status =
      message.includes("period") || message.includes("YYYY-MM-DD") || message.includes("before periodEnd")
        ? 400
        : 500;
    res.status(status).json({ error: message });
  }
}

export async function getOne(req: AuthRequest, res: Response) {
  try {
    const { id } = req.params;
    const machine = await getMachineById(id);
    if (!machine) {
      res.status(404).json({ error: "Machine not found" });
      return;
    }
    res.json(machine);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to get machine";
    res.status(500).json({ error: message });
  }
}

export async function create(req: AuthRequest, res: Response) {
  try {
    const actor = req.user!;
    const input = req.body as CreateMachineInput;
    const machine = await createMachine(
      { userId: actor.userId, email: actor.email, role: actor.role },
      input
    );
    res.status(201).json(machine);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create machine";
    const status = message.includes("required") || message.includes("project") ? 400 : 500;
    res.status(status).json({ error: message });
  }
}

export async function update(req: AuthRequest, res: Response) {
  try {
    const actor = req.user!;
    const { id } = req.params;
    const input = req.body as UpdateMachineInput;
    const machine = await updateMachine(
      { userId: actor.userId, email: actor.email, role: actor.role },
      id,
      input
    );
    res.json(machine);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update machine";
    const status =
      message === "Machine not found" ? 404
        : message.includes("required") || message.includes("empty") ? 400
        : 500;
    res.status(status).json({ error: message });
  }
}

export async function remove(req: AuthRequest, res: Response) {
  try {
    const actor = req.user!;
    const { id } = req.params;
    await deleteMachine({ userId: actor.userId, email: actor.email, role: actor.role }, id);
    res.status(204).send();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete machine";
    const status =
      message === "Machine not found" ? 404
        : message.includes("Cannot delete") ? 400
        : 500;
    res.status(status).json({ error: message });
  }
}
