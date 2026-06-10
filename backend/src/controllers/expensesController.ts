import { Response } from "express";
import {
  listExpenses,
  listCategories,
  getExpenseById,
  createExpense,
  updateExpense,
  deleteExpense,
  type CreateExpenseInput,
  type UpdateExpenseInput,
} from "../services/expenseService.js";
import type { AuthRequest } from "../middleware/auth.js";

export async function list(req: AuthRequest, res: Response) {
  try {
    const actor = req.user!;
    const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
    const search = typeof req.query.search === "string" ? req.query.search : undefined;
    const category = typeof req.query.category === "string" ? req.query.category : undefined;
    const page = req.query.page ? Number(req.query.page) : undefined;
    const pageSize = req.query.pageSize ? Number(req.query.pageSize) : undefined;
    const startDate = typeof req.query.startDate === "string" ? req.query.startDate : undefined;
    const endDate = typeof req.query.endDate === "string" ? req.query.endDate : undefined;

    const result = await listExpenses(
      { userId: actor.userId, role: actor.role },
      { projectId, search, category, page, pageSize, startDate, endDate }
    );
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list expenses";
    res.status(500).json({ error: message });
  }
}

export async function listCategoriesHandler(req: AuthRequest, res: Response) {
  try {
    const actor = req.user!;
    const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
    const categories = await listCategories(
      { userId: actor.userId, role: actor.role },
      projectId
    );
    res.json(categories);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list categories";
    res.status(500).json({ error: message });
  }
}

export async function getOne(req: AuthRequest, res: Response) {
  try {
    const { id } = req.params;
    const expense = await getExpenseById(id);
    if (!expense) {
      res.status(404).json({ error: "Expense not found" });
      return;
    }
    res.json(expense);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to get expense";
    res.status(500).json({ error: message });
  }
}

export async function create(req: AuthRequest, res: Response) {
  try {
    const actor = req.user!;
    const input = req.body as CreateExpenseInput;
    const expense = await createExpense(
      { userId: actor.userId, email: actor.email, role: actor.role },
      input
    );
    res.status(201).json(expense);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create expense";
    const status = message.includes("required") || message.includes("Project is required") ? 400 : 500;
    res.status(status).json({ error: message });
  }
}

export async function update(req: AuthRequest, res: Response) {
  try {
    const actor = req.user!;
    const { id } = req.params;
    const input = req.body as UpdateExpenseInput;
    const expense = await updateExpense(
      { userId: actor.userId, email: actor.email, role: actor.role },
      id,
      input
    );
    res.json(expense);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update expense";
    const status =
      message === "Expense not found" ? 404
        : message.includes("required") ? 400
        : 500;
    res.status(status).json({ error: message });
  }
}

export async function remove(req: AuthRequest, res: Response) {
  try {
    const actor = req.user!;
    const { id } = req.params;
    await deleteExpense({ userId: actor.userId, email: actor.email, role: actor.role }, id);
    res.status(204).send();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete expense";
    const status =
      message === "Expense not found" ? 404
        : message.includes("Cannot delete") ? 400
        : 500;
    res.status(status).json({ error: message });
  }
}
