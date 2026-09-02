import { Response } from "express";
import {
  listConsumableItems,
  getConsumableItemById,
  createConsumableItem,
  updateConsumableItem,
  deleteConsumableItem,
  getDieselItem,
  type CreateConsumableItemInput,
  type UpdateConsumableItemInput,
} from "../services/consumableItemService.js";
import { createItemLedgerEntriesBulk, BulkItemValidationError, type BulkItemLedgerInput } from "../services/itemLedgerService.js";
import type { AuthRequest } from "../middleware/auth.js";

export async function list(req: AuthRequest, res: Response) {
  try {
    const actor = req.user!;
    const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
    const items = await listConsumableItems({ userId: actor.userId, role: actor.role }, projectId);
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to list items" });
  }
}

export async function getOne(req: AuthRequest, res: Response) {
  try {
    const item = await getConsumableItemById(req.params.id);
    if (!item) { res.status(404).json({ error: "Item not found" }); return; }
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to get item" });
  }
}

export async function getDiesel(req: AuthRequest, res: Response) {
  try {
    const actor = req.user!;
    const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
    res.json({ item: await getDieselItem({ userId: actor.userId, role: actor.role }, projectId) });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to find diesel item" });
  }
}

export async function bulkCreateLedger(req: AuthRequest, res: Response) {
  try {
    const actor = req.user!;
    res.status(201).json(await createItemLedgerEntriesBulk(
      { userId: actor.userId, email: actor.email, role: actor.role }, req.body as BulkItemLedgerInput
    ));
  } catch (err) {
    if (err instanceof BulkItemValidationError) {
      res.status(400).json({ error: err.message, rows: err.rows }); return;
    }
    const message = err instanceof Error ? err.message : "Failed to create bulk ledger entries";
    res.status(400).json({ error: message });
  }
}

export async function create(req: AuthRequest, res: Response) {
  try {
    const actor = req.user!;
    const item = await createConsumableItem(
      { userId: actor.userId, email: actor.email, role: actor.role },
      req.body as CreateConsumableItemInput
    );
    res.status(201).json(item);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create item";
    const status = msg.includes("required") || msg.includes("already exists") ? 400 : 500;
    res.status(status).json({ error: msg });
  }
}

export async function update(req: AuthRequest, res: Response) {
  try {
    const actor = req.user!;
    const item = await updateConsumableItem(
      { userId: actor.userId, email: actor.email, role: actor.role },
      req.params.id,
      req.body as UpdateConsumableItemInput
    );
    res.json(item);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to update item";
    const status =
      msg === "Item not found" ? 404 : msg.includes("already exists") || msg.includes("empty") ? 400 : 500;
    res.status(status).json({ error: msg });
  }
}

export async function remove(req: AuthRequest, res: Response) {
  try {
    const actor = req.user!;
    await deleteConsumableItem(
      { userId: actor.userId, email: actor.email, role: actor.role },
      req.params.id
    );
    res.status(204).send();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to delete item";
    const status =
      msg === "Item not found" ? 404 : msg.includes("Cannot delete") ? 400 : 500;
    res.status(status).json({ error: msg });
  }
}
