import { Response } from "express";
import {
  listStockConsumption,
  createStockConsumption,
  updateStockConsumption,
  deleteStockConsumption,
  type CreateConsumptionInput,
  type UpdateConsumptionInput,
} from "../services/stockConsumptionService.js";
import type { AuthRequest } from "../middleware/auth.js";

export async function list(req: AuthRequest, res: Response) {
  try {
    const actor = req.user!;
    const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
    const entries = await listStockConsumption({ userId: actor.userId, role: actor.role }, projectId);
    res.json(entries);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to list consumption" });
  }
}

export async function create(req: AuthRequest, res: Response) {
  try {
    const actor = req.user!;
    const entry = await createStockConsumption(
      { userId: actor.userId, email: actor.email, role: actor.role },
      req.body as CreateConsumptionInput
    );
    res.status(201).json(entry);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to record consumption";
    const status = msg.includes("required") || msg.includes("Insufficient") || msg.includes("not found") ? 400 : 500;
    res.status(status).json({ error: msg });
  }
}

export async function update(req: AuthRequest, res: Response) {
  try {
    const actor = req.user!;
    const entry = await updateStockConsumption(
      { userId: actor.userId, email: actor.email, role: actor.role },
      req.params.id,
      req.body as UpdateConsumptionInput
    );
    res.json(entry);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to update consumption";
    const status = msg.includes("not found") ? 404 : msg.includes("Insufficient") || msg.includes("linked to a machine") ? 400 : 500;
    res.status(status).json({ error: msg });
  }
}

export async function remove(req: AuthRequest, res: Response) {
  try {
    const actor = req.user!;
    await deleteStockConsumption(
      { userId: actor.userId, email: actor.email, role: actor.role },
      req.params.id
    );
    res.status(204).send();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to delete consumption";
    const status = msg.includes("not found") ? 404 : msg.includes("linked to a machine") ? 400 : 500;
    res.status(status).json({ error: msg });
  }
}
