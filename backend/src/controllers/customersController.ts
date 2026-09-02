import { Response } from "express";
import {
  listCustomers,
  getCustomerById,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  type CreateCustomerInput,
  type UpdateCustomerInput,
} from "../services/customerService.js";
import type { AuthRequest } from "../middleware/auth.js";

export async function list(req: AuthRequest, res: Response) {
  try {
    const actor = req.user!;
    const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
    const startDate = typeof req.query.startDate === "string" ? req.query.startDate : undefined;
    const endDate = typeof req.query.endDate === "string" ? req.query.endDate : undefined;
    const items = await listCustomers(
      { userId: actor.userId, role: actor.role },
      projectId,
      { startDate, endDate }
    );
    res.json(items);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list customers";
    res.status(500).json({ error: message });
  }
}

export async function getOne(req: AuthRequest, res: Response) {
  try {
    const { id } = req.params;
    const customer = await getCustomerById(id);
    if (!customer) {
      res.status(404).json({ error: "Customer not found" });
      return;
    }
    res.json(customer);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to get customer";
    res.status(500).json({ error: message });
  }
}

export async function create(req: AuthRequest, res: Response) {
  try {
    const actor = req.user!;
    const input = req.body as CreateCustomerInput;
    const customer = await createCustomer(
      { userId: actor.userId, email: actor.email, role: actor.role },
      input
    );
    res.status(201).json(customer);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create customer";
    const status = message.includes("required") ? 400 : 500;
    res.status(status).json({ error: message });
  }
}

export async function update(req: AuthRequest, res: Response) {
  try {
    const actor = req.user!;
    const { id } = req.params;
    const input = req.body as UpdateCustomerInput;
    const customer = await updateCustomer(
      { userId: actor.userId, email: actor.email, role: actor.role },
      id,
      input
    );
    res.json(customer);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update customer";
    const status =
      message === "Customer not found" ? 404
        : message.includes("required") ? 400
        : 500;
    res.status(status).json({ error: message });
  }
}

export async function remove(req: AuthRequest, res: Response) {
  try {
    const actor = req.user!;
    const { id } = req.params;
    await deleteCustomer({ userId: actor.userId, email: actor.email, role: actor.role }, id);
    res.status(204).send();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete customer";
    const status =
      message === "Customer not found" ? 404
        : message.includes("Cannot delete") ? 400
        : 500;
    res.status(status).json({ error: message });
  }
}
