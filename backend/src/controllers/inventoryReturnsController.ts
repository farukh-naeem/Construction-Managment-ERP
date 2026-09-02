import type { Response } from "express";
import type { AuthRequest } from "../middleware/auth.js";
import { createInventoryReturn, listInventoryReturns, type CreateInventoryReturnInput } from "../services/inventoryReturnService.js";

export async function list(req: AuthRequest, res: Response) {
  try {
    const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
    res.json(await listInventoryReturns({ userId: req.user!.userId, role: req.user!.role }, projectId));
  } catch (error) { res.status(500).json({ error: error instanceof Error ? error.message : "Failed to list returns" }); }
}

export async function create(req: AuthRequest, res: Response) {
  try {
    res.status(201).json(await createInventoryReturn(req.user!, req.body as CreateInventoryReturnInput));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to record return";
    const status = message.includes("not found") ? 404 : message.includes("required") || message.includes("Invalid") || message.includes("exceeds") || message.includes("Only") || message.includes("Duplicate") || message.includes("greater") || message.includes("belong") ? 400 : 500;
    res.status(status).json({ error: message });
  }
}
