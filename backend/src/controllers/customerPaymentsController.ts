import { Response } from "express";
import {
  getCustomerLedger,
  createCustomerPayment,
  deleteCustomerPayment,
  type CreateCustomerPaymentInput,
} from "../services/customerPaymentService.js";
import type { AuthRequest } from "../middleware/auth.js";

export async function getCustomerLedgerHandler(req: AuthRequest, res: Response) {
  try {
    const { customerId } = req.params;
    const page = req.query.page ? parseInt(req.query.page as string, 10) : undefined;
    const pageSize = req.query.pageSize ? parseInt(req.query.pageSize as string, 10) : undefined;
    const startDate = typeof req.query.startDate === "string" ? req.query.startDate : undefined;
    const endDate = typeof req.query.endDate === "string" ? req.query.endDate : undefined;
    const ledger = await getCustomerLedger(customerId, { page, pageSize, startDate, endDate });
    res.json(ledger);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to get customer ledger";
    const status = message.includes("Invalid") ? 400 : 500;
    res.status(status).json({ error: message });
  }
}

export async function createPayment(req: AuthRequest, res: Response) {
  try {
    const actor = req.user!;
    const { customerId } = req.params;
    const input = req.body as CreateCustomerPaymentInput;
    const payment = await createCustomerPayment(
      { userId: actor.userId, email: actor.email, role: actor.role },
      customerId,
      input
    );
    res.status(201).json(payment);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to record payment";
    const status =
      message.includes("not found") ? 404
        : message.includes("required") || message.includes("Invalid") || message.includes("Select a bank account") || message.includes("greater than 0") ? 400
        : 500;
    res.status(status).json({ error: message });
  }
}

export async function deletePayment(req: AuthRequest, res: Response) {
  try {
    const actor = req.user!;
    const { customerId, paymentId } = req.params;
    await deleteCustomerPayment(
      { userId: actor.userId, email: actor.email, role: actor.role },
      customerId,
      paymentId
    );
    res.status(204).send();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete payment";
    const status =
      message.includes("not found") ? 404
        : message.includes("Cannot delete") || message.includes("Invalid") || message.includes("does not belong") ? 400
        : 500;
    res.status(status).json({ error: message });
  }
}
