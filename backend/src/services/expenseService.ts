import mongoose from "mongoose";
import { Expense } from "../models/Expense.js";
import { User } from "../models/User.js";
import { logAudit } from "./auditService.js";
import { roleDisplay } from "./authService.js";

export type PaymentMode = "Cash" | "Bank" | "Online";

export interface ExpensePayload {
  id: string;
  projectId: string;
  date: string;
  description: string;
  category: string;
  paymentMode: PaymentMode;
  amount: number;
}

export interface CreateExpenseInput {
  projectId: string;
  date: string;
  description: string;
  category: string;
  paymentMode: PaymentMode;
  amount: number;
}

export interface UpdateExpenseInput {
  date?: string;
  description?: string;
  category?: string;
  paymentMode?: PaymentMode;
  amount?: number;
}

export interface ListExpensesParams {
  projectId?: string;
  search?: string;
  category?: string;
  page?: number;
  pageSize?: number;
  startDate?: string;
  endDate?: string;
}

export interface ListExpensesResult {
  expenses: ExpensePayload[];
  total: number;
  totalAmount: number;
  previousTotal?: number;
}

const DEFAULT_PAGE_SIZE = 12;
const MAX_PAGE_SIZE = 500;

function toPayload(
  doc: {
    _id: mongoose.Types.ObjectId;
    projectId: mongoose.Types.ObjectId;
    date: string;
    description: string;
    category: string;
    paymentMode: PaymentMode;
    amount: number;
  }
): ExpensePayload {
  return {
    id: doc._id.toString(),
    projectId: doc.projectId?.toString() ?? "",
    date: doc.date,
    description: doc.description,
    category: doc.category,
    paymentMode: doc.paymentMode,
    amount: doc.amount,
  };
}

/** Resolve projectId for actor. Site Manager uses assigned project; Admin/Super Admin use param. */
async function resolveProjectId(
  actor: { userId: string; role: string },
  projectIdParam?: string
): Promise<string | undefined> {
  if (actor.role === "site_manager") {
    const user = await User.findById(actor.userId).select("assignedProjectId").lean();
    return user?.assignedProjectId?.toString();
  }
  return projectIdParam;
}

/** List expenses with pagination, search, and category filter. */
export async function listExpenses(
  actor: { userId: string; role: string },
  params: ListExpensesParams
): Promise<ListExpensesResult> {
  const projectId = await resolveProjectId(actor, params.projectId);
  if (actor.role === "site_manager" && !projectId) return { expenses: [], total: 0, totalAmount: 0 };

  const pageSize = Math.min(Math.max(1, params.pageSize ?? DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
  const page = params.page !== undefined ? Math.max(1, Number(params.page)) : 1;
  const skip = (page - 1) * pageSize;

  const filter: Record<string, unknown> = {};
  if (projectId && mongoose.Types.ObjectId.isValid(projectId)) {
    filter.projectId = new mongoose.Types.ObjectId(projectId);
  }
  if (params.category && params.category !== "all") {
    filter.category = params.category;
  }
  if (params.search?.trim()) {
    filter.description = { $regex: params.search.trim(), $options: "i" };
  }
  if (params.startDate || params.endDate) {
    const dateFilter: Record<string, string> = {};
    if (params.startDate) dateFilter.$gte = params.startDate;
    if (params.endDate) dateFilter.$lte = params.endDate;
    filter.date = dateFilter;
  }

  const sortDir = params.startDate ? 1 : -1;

  const [docs, total, aggResult] = await Promise.all([
    Expense.find(filter).sort({ date: sortDir, createdAt: sortDir }).skip(skip).limit(pageSize).lean(),
    Expense.countDocuments(filter),
    Expense.aggregate<{ totalAmount: number }>([{ $match: filter }, { $group: { _id: null, totalAmount: { $sum: "$amount" } } }]),
  ]);

  const expenses = docs.map(toPayload);
  const totalAmount = aggResult[0]?.totalAmount ?? 0;

  let previousTotal: number | undefined;
  if (params.startDate && projectId && mongoose.Types.ObjectId.isValid(projectId)) {
    const prevFilter: Record<string, unknown> = { ...filter, date: { $lt: params.startDate } };
    const prevAgg = await Expense.aggregate<{ sum: number }>([
      { $match: prevFilter },
      { $group: { _id: null, sum: { $sum: "$amount" } } },
    ]);
    previousTotal = prevAgg[0]?.sum ?? 0;
  }

  return { expenses, total, totalAmount, previousTotal };
}

/** Get distinct category names (for filter combobox). Site Manager: uses assigned project. Admin/Super Admin: projectId param (all projects if omitted). */
export async function listCategories(
  actor: { userId: string; role: string },
  projectIdParam?: string
): Promise<string[]> {
  const projectId = await resolveProjectId(actor, projectIdParam);
  if (actor.role === "site_manager" && !projectId) return [];

  const filter: Record<string, unknown> = {};
  if (projectId && mongoose.Types.ObjectId.isValid(projectId)) {
    filter.projectId = new mongoose.Types.ObjectId(projectId);
  }
  const categories = await Expense.distinct("category", filter);
  return categories.sort();
}

export async function getExpenseById(id: string): Promise<ExpensePayload | null> {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const doc = await Expense.findById(id).lean();
  return doc ? toPayload(doc) : null;
}

/** Create expense. Site Manager: uses assigned project. Admin/Super Admin: requires projectId in input. */
export async function createExpense(
  actor: { userId: string; email: string; role: string },
  input: CreateExpenseInput
): Promise<ExpensePayload> {
  if (!input.date?.trim()) throw new Error("Date is required");
  if (!input.description?.trim()) throw new Error("Description is required");
  if (!input.category?.trim()) throw new Error("Category is required");
  if (input.amount == null || isNaN(input.amount) || input.amount < 0) {
    throw new Error("Amount must be a non-negative number");
  }

  let projectId: string;
  if (actor.role === "site_manager") {
    const user = await User.findById(actor.userId).select("assignedProjectId").lean();
    projectId = user?.assignedProjectId?.toString() ?? "";
    if (!projectId) throw new Error("Site Manager must be assigned to a project to create expenses");
  } else {
    projectId = input.projectId ?? "";
    if (!projectId || !mongoose.Types.ObjectId.isValid(projectId)) {
      throw new Error("Project is required");
    }
  }

  const expense = await Expense.create({
    projectId,
    date: input.date.trim(),
    description: input.description.trim(),
    category: input.category.trim(),
    paymentMode: input.paymentMode,
    amount: input.amount,
  });

  const actorUser = await User.findById(actor.userId).lean();
  const role = roleDisplay[actor.role as keyof typeof roleDisplay] ?? actor.role;
  await logAudit({
    userId: actor.userId,
    userName: actorUser?.name ?? "Unknown",
    userEmail: actor.email,
    role,
    action: "create",
    module: "expenses",
    entityId: expense._id.toString(),
    description: `Expense: ${expense.description} — ${expense.amount}`,
    newValue: { description: expense.description, amount: expense.amount },
  });

  return toPayload(expense);
}

export async function updateExpense(
  actor: { userId: string; email: string; role: string },
  id: string,
  input: UpdateExpenseInput
): Promise<ExpensePayload> {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new Error("Invalid expense ID");
  }

  const target = await Expense.findById(id);
  if (!target) {
    throw new Error("Expense not found");
  }

  const updates: Record<string, unknown> = {};
  if (input.date != null) updates.date = input.date.trim();
  if (input.description != null) updates.description = input.description.trim();
  if (input.category != null) updates.category = input.category.trim();
  if (input.paymentMode != null) updates.paymentMode = input.paymentMode;
  if (input.amount != null) {
    if (input.amount < 0 || isNaN(input.amount)) {
      throw new Error("Amount must be a non-negative number");
    }
    updates.amount = input.amount;
  }

  const updated = await Expense.findByIdAndUpdate(id, updates, { new: true }).lean();
  if (!updated) throw new Error("Update failed");

  const actorUser = await User.findById(actor.userId).lean();
  const role = roleDisplay[actor.role as keyof typeof roleDisplay] ?? actor.role;
  await logAudit({
    userId: actor.userId,
    userName: actorUser?.name ?? "Unknown",
    userEmail: actor.email,
    role,
    action: "update",
    module: "expenses",
    entityId: id,
    description: `Updated expense: ${target.description}`,
    oldValue: { description: target.description },
    newValue: { description: updated.description },
  });

  return toPayload(updated);
}

export async function deleteExpense(
  actor: { userId: string; email: string; role: string },
  id: string
): Promise<void> {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new Error("Invalid expense ID");
  }

  const target = await Expense.findById(id);
  if (!target) {
    throw new Error("Expense not found");
  }

  await Expense.findByIdAndDelete(id);

  const actorUser = await User.findById(actor.userId).lean();
  const role = roleDisplay[actor.role as keyof typeof roleDisplay] ?? actor.role;
  await logAudit({
    userId: actor.userId,
    userName: actorUser?.name ?? "Unknown",
    userEmail: actor.email,
    role,
    action: "delete",
    module: "expenses",
    entityId: id,
    description: `Deleted expense: ${target.description}`,
    oldValue: { description: target.description },
  });
}
