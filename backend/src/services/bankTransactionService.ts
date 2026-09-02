import mongoose from "mongoose";
import { BankAccount } from "../models/BankAccount.js";
import { BankTransaction } from "../models/BankTransaction.js";
import { Project } from "../models/Project.js";
import { Client } from "../models/Client.js";
import { findOrCreateCustomHead } from "./customHeadService.js";
import { User } from "../models/User.js";
import { logAudit, getProjectName } from "./auditService.js";
import { roleDisplay } from "./authService.js";
import type { BankTransactionType, BankTransactionMode } from "../models/BankTransaction.js";

export interface BankTransactionPayload {
  id: string;
  accountId: string;
  accountName?: string;
  date: string;
  type: BankTransactionType;
  amount: number;
  source: string;
  destination: string;
  clientId?: string;
  clientName?: string;
  projectId?: string;
  projectName?: string;
  customHeadId?: string;
  customHeadName?: string;
  mode: BankTransactionMode;
  referenceId?: string;
  remarks?: string;
}

export interface CreateBankTransactionInput {
  accountId: string;
  date: string;
  type: BankTransactionType;
  amount: number;
  source: string;
  destination: string;
  clientId?: string;
  projectId?: string;
  customHeadId?: string;
  customHeadName?: string;
  mode?: BankTransactionMode;
  referenceId?: string;
  remarks?: string;
}

export interface UpdateBankTransactionInput {
  date?: string;
  amount?: number;
  source?: string;
  destination?: string;
  clientId?: string;
  projectId?: string;
  customHeadId?: string;
  customHeadName?: string;
  mode?: BankTransactionMode;
  referenceId?: string;
  remarks?: string;
}

export interface ListBankTransactionsOptions {
  page?: number;
  pageSize?: number;
  search?: string;
  startDate?: string;
  endDate?: string;
}

export interface BankAccountLedgerRow {
  id: string; date: string; particulars: string; received?: number; outflows: Record<string, number>; balance: number;
}
export interface BankAccountLedgerResult {
  accountName: string; accountNumber: string; columns: { key: string; label: string; kind: "project" | "head" }[]; rows: BankAccountLedgerRow[]; openingBalance: number;
}

const DEFAULT_PAGE_SIZE = 12;
const MAX_PAGE_SIZE = 100;

function toPayload(doc: {
  _id: mongoose.Types.ObjectId;
  accountId: mongoose.Types.ObjectId;
  date: string;
  type: string;
  amount: number;
  source: string;
  destination: string;
  clientId?: mongoose.Types.ObjectId;
  projectId?: mongoose.Types.ObjectId;
  customHeadId?: mongoose.Types.ObjectId;
  mode: string;
  referenceId?: string;
  remarks?: string;
}, accountName?: string, projectName?: string, clientName?: string, customHeadName?: string): BankTransactionPayload {
  return {
    id: doc._id.toString(),
    accountId: doc.accountId.toString(),
    accountName,
    date: doc.date,
    type: doc.type as BankTransactionType,
    amount: doc.amount,
    source: doc.source,
    destination: doc.destination,
    clientId: doc.clientId?.toString(),
    clientName,
    projectId: doc.projectId?.toString(),
    projectName,
    customHeadId: doc.customHeadId?.toString(),
    customHeadName,
    mode: doc.mode as BankTransactionMode,
    referenceId: doc.referenceId,
    remarks: doc.remarks,
  };
}

export async function listBankTransactions(options?: ListBankTransactionsOptions): Promise<{
  rows: BankTransactionPayload[];
  total: number;
}> {
  const page = Math.max(1, options?.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, options?.pageSize ?? DEFAULT_PAGE_SIZE));
  const search = options?.search?.trim();
  const startDate = options?.startDate?.trim();
  const endDate = options?.endDate?.trim();

  const filter: Record<string, unknown> = {};

  if (startDate || endDate) {
    filter.date = {};
    if (startDate) (filter.date as Record<string, string>).$gte = startDate;
    if (endDate) (filter.date as Record<string, string>).$lte = endDate;
  }

  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const searchRegex = new RegExp(escaped, "i");
    filter.$or = [
      { source: searchRegex },
      { destination: searchRegex },
      { referenceId: searchRegex },
      { remarks: searchRegex },
    ];
  }

  const [total, docs] = await Promise.all([
    BankTransaction.countDocuments(filter),
    BankTransaction.find(filter)
      .sort({ date: -1, createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .populate("accountId", "name")
      .populate("projectId", "name")
      .populate("clientId", "name")
      .populate("customHeadId", "name")
      .lean(),
  ]);

  const rows = docs.map((d) => {
    const acc = d.accountId as { _id: mongoose.Types.ObjectId; name?: string } | null;
    const proj = d.projectId as { _id: mongoose.Types.ObjectId; name?: string } | null;
    const client = d.clientId as { _id: mongoose.Types.ObjectId; name?: string } | null;
    const head = d.customHeadId as { _id: mongoose.Types.ObjectId; name?: string } | null;
    return toPayload(
      {
        _id: d._id,
        accountId: acc?._id ?? d.accountId as mongoose.Types.ObjectId,
        date: d.date,
        type: d.type,
        amount: d.amount,
        source: d.source,
        destination: d.destination,
        clientId: client?._id ?? d.clientId as mongoose.Types.ObjectId | undefined,
        projectId: proj?._id ?? d.projectId as mongoose.Types.ObjectId | undefined,
        customHeadId: head?._id ?? d.customHeadId as mongoose.Types.ObjectId | undefined,
        mode: d.mode,
        referenceId: d.referenceId,
        remarks: d.remarks,
      },
      acc?.name,
      proj?.name,
      client?.name,
      head?.name
    );
  });

  return { rows, total };
}

export async function getBankAccountLedger(accountId: string, startDate?: string, endDate?: string): Promise<BankAccountLedgerResult> {
  if (!mongoose.Types.ObjectId.isValid(accountId)) throw new Error("Invalid account ID");
  const account = await BankAccount.findById(accountId).lean();
  if (!account) throw new Error("Account not found");
  const docs = await BankTransaction.find({ accountId: new mongoose.Types.ObjectId(accountId) })
    .sort({ date: 1, createdAt: 1, _id: 1 }).populate("projectId", "name").populate("customHeadId", "name").lean();
  const columns = new Map<string, { key: string; label: string; kind: "project" | "head" }>();
  for (const doc of docs) if (doc.type === "outflow") {
    const project = doc.projectId as unknown as { _id?: mongoose.Types.ObjectId; name?: string } | null;
    const head = doc.customHeadId as unknown as { _id?: mongoose.Types.ObjectId; name?: string } | null;
    if (project?._id) columns.set(`project:${project._id}`, { key: `project:${project._id}`, label: project.name ?? doc.destination, kind: "project" });
    else if (head?._id) columns.set(`head:${head._id}`, { key: `head:${head._id}`, label: head.name ?? doc.destination, kind: "head" });
    else columns.set(`legacy:${doc.destination}`, { key: `legacy:${doc.destination}`, label: doc.destination, kind: "head" });
  }
  const orderedColumns = [...columns.values()].sort((a, b) => a.kind === b.kind ? a.label.localeCompare(b.label) : a.kind === "project" ? -1 : 1);
  let balance = account.openingBalance ?? 0;
  const rows: BankAccountLedgerRow[] = [];
  for (const doc of docs) {
    balance += doc.type === "inflow" ? doc.amount : -doc.amount;
    if ((startDate && doc.date < startDate) || (endDate && doc.date > endDate)) continue;
    const project = doc.projectId as unknown as { _id?: mongoose.Types.ObjectId } | null;
    const head = doc.customHeadId as unknown as { _id?: mongoose.Types.ObjectId } | null;
    const key = project?._id ? `project:${project._id}` : head?._id ? `head:${head._id}` : `legacy:${doc.destination}`;
    rows.push({ id: doc._id.toString(), date: doc.date, particulars: (doc.type === "inflow" ? [doc.source, doc.referenceId, doc.remarks] : [doc.referenceId, doc.remarks]).filter(Boolean).join(" — ") || "—", received: doc.type === "inflow" ? doc.amount : undefined, outflows: doc.type === "outflow" ? { [key]: doc.amount } : {}, balance });
  }
  return { accountName: account.name, accountNumber: account.accountNumber ?? "", columns: orderedColumns, rows, openingBalance: account.openingBalance ?? 0 };
}

export async function createBankTransaction(
  actor: { userId: string; email: string; role: string },
  input: CreateBankTransactionInput
): Promise<BankTransactionPayload> {
  if (!mongoose.Types.ObjectId.isValid(input.accountId)) {
    throw new Error("Invalid account ID");
  }
  const amount = Number(input.amount);
  if (isNaN(amount) || amount <= 0) {
    throw new Error("Valid amount is required");
  }
  if (!input.date?.trim()) {
    throw new Error("Date is required");
  }
  if (!input.source?.trim()) {
    throw new Error("Source is required");
  }
  if (!input.destination?.trim()) {
    throw new Error("Destination is required");
  }
  if (input.type !== "inflow" && input.type !== "outflow") {
    throw new Error("Type must be inflow or outflow");
  }

  const mode = (input.mode ?? "Bank") as BankTransactionMode;
  if (!["Cash", "Bank", "Online"].includes(mode)) {
    throw new Error("Invalid mode");
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const account = await BankAccount.findById(input.accountId).session(session);
    if (!account) {
      throw new Error("Account not found");
    }

    if (input.type === "outflow") {
      if (account.currentBalance < amount) {
        throw new Error("Insufficient bank balance. Cannot create outflow that would make balance negative.");
      }
    }

    let projectId: mongoose.Types.ObjectId | undefined;
    if (input.projectId) {
      if (!mongoose.Types.ObjectId.isValid(input.projectId)) {
        throw new Error("Invalid project ID");
      }
      const project = await Project.findById(input.projectId).session(session);
      if (!project) {
        throw new Error("Project not found");
      }
      projectId = project._id;
    }
    let clientId: mongoose.Types.ObjectId | undefined;
    if (input.clientId) {
      if (input.type !== "inflow") throw new Error("Client can only be set for inflow transactions");
      if (!mongoose.Types.ObjectId.isValid(input.clientId)) throw new Error("Invalid client ID");
      const client = await Client.findById(input.clientId).session(session);
      if (!client) throw new Error("Client not found");
      clientId = client._id;
    }
    let customHeadId: mongoose.Types.ObjectId | undefined;
    let destination = input.destination.trim();
    if (input.type === "outflow" && !projectId && (input.customHeadId || input.customHeadName)) {
      const head = input.customHeadId
        ? await (await import("../models/CustomHead.js")).CustomHead.findById(input.customHeadId).session(session)
        : null;
      const resolved = head ? { id: head._id.toString(), name: head.name } : await findOrCreateCustomHead(input.customHeadName ?? destination);
      customHeadId = new mongoose.Types.ObjectId(resolved.id);
      destination = resolved.name;
    }

    const doc = await BankTransaction.create(
      [
        {
          accountId: input.accountId,
          date: input.date.trim(),
          type: input.type,
          amount,
          source: input.source.trim(),
          destination,
          clientId,
          projectId,
          customHeadId,
          mode,
          referenceId: input.referenceId?.trim(),
          remarks: input.remarks?.trim(),
        },
      ],
      { session }
    );
    const tx = doc[0];

    if (input.type === "inflow") {
      await BankAccount.findByIdAndUpdate(
        input.accountId,
        {
          $inc: { currentBalance: amount, totalInflow: amount },
        },
        { session }
      );
    } else {
      await BankAccount.findByIdAndUpdate(
        input.accountId,
        {
          $inc: { currentBalance: -amount, totalOutflow: amount },
        },
        { session }
      );
      if (projectId) {
        await Project.findByIdAndUpdate(
          projectId,
          { $inc: { balance: amount } },
          { session }
        );
      }
    }

    await session.commitTransaction();

    const actorUser = await User.findById(actor.userId).lean();
    const role = roleDisplay[actor.role as keyof typeof roleDisplay] ?? actor.role;
    await logAudit({
      userId: actor.userId,
      userName: actorUser?.name ?? "Unknown",
      userEmail: actor.email,
      role,
      action: "create",
      module: "bank_transactions",
      entityId: tx._id.toString(),
      projectId: input.projectId,
      projectName: await getProjectName(input.projectId),
      description: `${input.type}: ${amount} — ${input.source} → ${input.destination}`,
      newValue: { type: input.type, amount, accountId: input.accountId, projectId: input.projectId },
    });

    const populated = await BankTransaction.findById(tx._id)
      .populate("accountId", "name")
      .populate("projectId", "name")
      .populate("clientId", "name")
      .populate("customHeadId", "name")
      .lean();
    const acc = populated?.accountId as { name?: string } | null;
    const proj = populated?.projectId as { name?: string } | null;
    const client = populated?.clientId as { name?: string } | null;
    const head = populated?.customHeadId as { name?: string } | null;

    return toPayload(
      {
        _id: tx._id,
        accountId: new mongoose.Types.ObjectId(input.accountId),
        date: tx.date,
        type: tx.type,
        amount: tx.amount,
        source: tx.source,
        destination: tx.destination, clientId: tx.clientId,
        projectId: tx.projectId,
        customHeadId: tx.customHeadId,
        mode: tx.mode,
        referenceId: tx.referenceId,
        remarks: tx.remarks,
      },
      acc?.name,
      proj?.name, client?.name, head?.name
    );
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
}

export async function updateBankTransaction(
  actor: { userId: string; email: string; role: string },
  id: string,
  input: UpdateBankTransactionInput
): Promise<BankTransactionPayload> {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new Error("Invalid transaction ID");
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const existing = await BankTransaction.findById(id).session(session);
    if (!existing) {
      throw new Error("Transaction not found");
    }
    // Customer payments own their inflow — editing or deleting it here would desync the
    // customer's ledger from the bank. Route the change through the customer instead.
    if (existing.customerId) {
      throw new Error(
        "This transaction was created by a customer payment. Edit or delete it from the customer's ledger instead."
      );
    }

    // Reverse the existing transaction
    if (existing.type === "inflow") {
      await BankAccount.findByIdAndUpdate(
        existing.accountId,
        { $inc: { currentBalance: -existing.amount, totalInflow: -existing.amount } },
        { session }
      );
    } else {
      await BankAccount.findByIdAndUpdate(
        existing.accountId,
        { $inc: { currentBalance: existing.amount, totalOutflow: -existing.amount } },
        { session }
      );
      if (existing.projectId) {
        await Project.findByIdAndUpdate(
          existing.projectId,
          { $inc: { balance: -existing.amount } },
          { session }
        );
      }
    }

    const newAmount = input.amount != null ? Number(input.amount) : existing.amount;
    if (isNaN(newAmount) || newAmount <= 0) {
      throw new Error("Valid amount is required");
    }

    const newType = existing.type; // We don't allow changing type
    if (input.projectId && !mongoose.Types.ObjectId.isValid(input.projectId)) throw new Error("Invalid project ID");
    const newProjectId = input.projectId !== undefined
      ? (input.projectId ? new mongoose.Types.ObjectId(input.projectId) : undefined)
      : existing.projectId;
    if (newProjectId) {
      const project = await Project.findById(newProjectId).session(session);
      if (!project) throw new Error("Project not found");
    }
    let newClientId = existing.clientId;
    if (input.clientId !== undefined) {
      if (newType !== "inflow") throw new Error("Client can only be set for inflow transactions");
      if (input.clientId && !mongoose.Types.ObjectId.isValid(input.clientId)) throw new Error("Invalid client ID");
      if (input.clientId) {
        const client = await Client.findById(input.clientId).session(session);
        if (!client) throw new Error("Client not found");
        newClientId = client._id;
      } else newClientId = undefined;
    }

    if (newType === "outflow") {
      const account = await BankAccount.findById(existing.accountId).session(session);
      if (!account) throw new Error("Account not found");
      if (account.currentBalance < newAmount) {
        throw new Error("Insufficient bank balance. Cannot update outflow that would make balance negative.");
      }
    }

    const updates: Record<string, unknown> = {
      amount: newAmount,
      source: (input.source ?? existing.source).trim(),
      destination: (input.destination ?? existing.destination).trim(),
      mode: (input.mode ?? existing.mode) as BankTransactionMode,
      referenceId: (input.referenceId ?? existing.referenceId)?.trim(),
      remarks: (input.remarks ?? existing.remarks)?.trim(),
    };
    if (input.date != null) updates.date = input.date.trim();
    if (input.projectId !== undefined) updates.projectId = newProjectId;
    if (input.clientId !== undefined) updates.clientId = newClientId;

    const updated = await BankTransaction.findByIdAndUpdate(id, updates, { new: true, session });
    if (!updated) {
      throw new Error("Update failed");
    }

    // Apply the new transaction
    if (newType === "inflow") {
      await BankAccount.findByIdAndUpdate(
        existing.accountId,
        { $inc: { currentBalance: newAmount, totalInflow: newAmount } },
        { session }
      );
    } else {
      await BankAccount.findByIdAndUpdate(
        existing.accountId,
        { $inc: { currentBalance: -newAmount, totalOutflow: newAmount } },
        { session }
      );
      if (newProjectId) {
        await Project.findByIdAndUpdate(
          newProjectId,
          { $inc: { balance: newAmount } },
          { session }
        );
      }
    }

    await session.commitTransaction();

    const actorUser = await User.findById(actor.userId).lean();
    const role = roleDisplay[actor.role as keyof typeof roleDisplay] ?? actor.role;
    await logAudit({
      userId: actor.userId,
      userName: actorUser?.name ?? "Unknown",
      userEmail: actor.email,
      role,
      action: "update",
      module: "bank_transactions",
      entityId: id,
      projectId: newProjectId?.toString(),
      projectName: await getProjectName(newProjectId?.toString()),
      description: `Updated ${newType} transaction: ${newAmount}`,
      oldValue: { amount: existing.amount, source: existing.source, destination: existing.destination },
      newValue: { amount: newAmount, source: updated.source, destination: updated.destination },
    });

    const populated = await BankTransaction.findById(id)
      .populate("accountId", "name")
      .populate("projectId", "name")
      .lean();
    const acc = populated?.accountId as { name?: string } | null;
    const proj = populated?.projectId as { name?: string } | null;

    return toPayload(
      {
        _id: updated._id,
        accountId: updated.accountId as mongoose.Types.ObjectId,
        date: updated.date,
        type: updated.type,
        amount: updated.amount,
        source: updated.source,
        destination: updated.destination,
        projectId: updated.projectId as mongoose.Types.ObjectId | undefined,
        mode: updated.mode,
        referenceId: updated.referenceId,
        remarks: updated.remarks,
      },
      acc?.name,
      proj?.name
    );
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
}

export async function deleteBankTransaction(
  actor: { userId: string; email: string; role: string },
  id: string
): Promise<void> {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new Error("Invalid transaction ID");
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const existing = await BankTransaction.findById(id).session(session);
    if (!existing) {
      throw new Error("Transaction not found");
    }
    // Customer payments own their inflow — editing or deleting it here would desync the
    // customer's ledger from the bank. Route the change through the customer instead.
    if (existing.customerId) {
      throw new Error(
        "This transaction was created by a customer payment. Edit or delete it from the customer's ledger instead."
      );
    }

    // Reverse the transaction
    if (existing.type === "inflow") {
      const account = await BankAccount.findById(existing.accountId).session(session);
      if (!account) throw new Error("Account not found");
      if (account.currentBalance < existing.amount) {
        throw new Error("Cannot delete: reversing this inflow would make bank balance negative.");
      }
      await BankAccount.findByIdAndUpdate(
        existing.accountId,
        { $inc: { currentBalance: -existing.amount, totalInflow: -existing.amount } },
        { session }
      );
    } else {
      await BankAccount.findByIdAndUpdate(
        existing.accountId,
        { $inc: { currentBalance: existing.amount, totalOutflow: -existing.amount } },
        { session }
      );
      if (existing.projectId) {
        const project = await Project.findById(existing.projectId).session(session);
        if (!project) throw new Error("Project not found");
        if (project.balance < existing.amount) {
          throw new Error("Cannot delete: reversing this outflow would make project balance negative.");
        }
        await Project.findByIdAndUpdate(
          existing.projectId,
          { $inc: { balance: -existing.amount } },
          { session }
        );
      }
    }

    await BankTransaction.findByIdAndDelete(id, { session });
    await session.commitTransaction();

    const actorUser = await User.findById(actor.userId).lean();
    const role = roleDisplay[actor.role as keyof typeof roleDisplay] ?? actor.role;
    await logAudit({
      userId: actor.userId,
      userName: actorUser?.name ?? "Unknown",
      userEmail: actor.email,
      role,
      action: "delete",
      module: "bank_transactions",
      entityId: id,
      projectId: existing.projectId?.toString(),
      projectName: await getProjectName(existing.projectId?.toString()),
      description: `Deleted ${existing.type} transaction: ${existing.amount} — ${existing.source} → ${existing.destination}`,
      oldValue: { type: existing.type, amount: existing.amount },
    });
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
}
