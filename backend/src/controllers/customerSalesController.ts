import { Response } from "express";
import {
  listCustomerSales,
  getCustomerSale,
  createCustomerSale,
  deleteCustomerSale,
  type CreateCustomerSaleInput,
} from "../services/customerSaleService.js";
import type { AuthRequest } from "../middleware/auth.js";

export async function list(req: AuthRequest, res: Response) {
  try {
    const actor = req.user!;
    const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
    const sales = await listCustomerSales({ userId: actor.userId, role: actor.role }, projectId);
    res.json(sales);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list sales";
    res.status(500).json({ error: message });
  }
}

export async function getOne(req: AuthRequest, res: Response) {
  try {
    const { saleId } = req.params;
    const sale = await getCustomerSale(saleId);
    if (!sale) {
      res.status(404).json({ error: "Sale not found" });
      return;
    }
    res.json(sale);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to get sale";
    res.status(500).json({ error: message });
  }
}

export async function create(req: AuthRequest, res: Response) {
  try {
    const actor = req.user!;
    const input = req.body as CreateCustomerSaleInput;
    const sale = await createCustomerSale(
      { userId: actor.userId, email: actor.email, role: actor.role },
      input
    );
    res.status(201).json(sale);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to record sale";
    const status =
      message.includes("not found") ? 404
        : message.includes("required")
          || message.includes("Invalid")
          || message.includes("Insufficient stock")
          || message.includes("Duplicate item")
          || message.includes("Select a bank account")
          || message.includes("must be") ? 400
        : 500;
    res.status(status).json({ error: message });
  }
}

export async function remove(req: AuthRequest, res: Response) {
  try {
    const actor = req.user!;
    const { saleId } = req.params;
    await deleteCustomerSale({ userId: actor.userId, email: actor.email, role: actor.role }, saleId);
    res.status(204).send();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete sale";
    const status =
      message === "Sale not found" ? 404
        : message.includes("Cannot delete") || message.includes("Invalid") ? 400
        : 500;
    res.status(status).json({ error: message });
  }
}
