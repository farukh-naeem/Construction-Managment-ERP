import mongoose from "mongoose";
import { Customer } from "../models/Customer.js";
import { User } from "../models/User.js";
import { CustomerSaleEntry } from "../models/CustomerSaleEntry.js";
import { CustomerPayment } from "../models/CustomerPayment.js";
import { logAudit, getProjectName } from "./auditService.js";
import { roleDisplay } from "./authService.js";
import { resolveSiteManagerProjectId } from "./projectAccessService.js";

export interface CustomerPayload {
  id: string;
  projectId: string;
  name: string;
  phone: string;
  description: string;
  totalSold: number;
  totalReceived: number;
  /** Signed: positive = customer prepaid (credit); negative = customer owes us (receivable). */
  balance: number;
}

export interface CreateCustomerInput {
  projectId: string;
  name: string;
  phone?: string;
  description?: string;
}

export interface UpdateCustomerInput {
  name?: string;
  phone?: string;
  description?: string;
}

function toPayload(
  doc: { _id: mongoose.Types.ObjectId; projectId: mongoose.Types.ObjectId; name: string; phone?: string; description?: string; totalSold?: number; totalReceived?: number; balance?: number }
): CustomerPayload {
  return {
    id: doc._id.toString(),
    projectId: doc.projectId?.toString() ?? "",
    name: doc.name,
    phone: doc.phone ?? "",
    description: doc.description ?? "",
    totalSold: doc.totalSold ?? 0,
    totalReceived: doc.totalReceived ?? 0,
    balance: doc.balance ?? 0,
  };
}

export interface ListCustomersOptions {
  /** Inclusive "YYYY-MM-DD" range. When provided, totalSold/totalReceived/balance are recomputed
   *  from the underlying CustomerSaleEntry/CustomerPayment rows dated within the range, instead of
   *  returning the customer's all-time cumulative stored fields. */
  startDate?: string;
  endDate?: string;
}

/** List customers for a project. Site Manager: uses assigned project. Admin/Super Admin: uses projectId param. */
export async function listCustomers(
  actor: { userId: string; role: string },
  projectIdParam?: string,
  options?: ListCustomersOptions
): Promise<CustomerPayload[]> {
  let projectId: string | undefined;
  if (actor.role === "site_manager") {
    projectId = await resolveSiteManagerProjectId(actor.userId, projectIdParam);
    if (!projectId) return [];
  } else {
    projectId = projectIdParam;
  }
  const query =
    projectId && mongoose.Types.ObjectId.isValid(projectId) ? { projectId } : {};
  const docs = await Customer.find(query).lean();
  const payloads = docs.map(toPayload);

  const startDate = options?.startDate?.trim() || undefined;
  const endDate = options?.endDate?.trim() || undefined;
  if (!startDate && !endDate) return payloads;

  const customerIds = docs.map((d) => d._id);
  if (customerIds.length === 0) return payloads;

  const dateMatch: Record<string, unknown> = {};
  if (startDate) dateMatch.date = { $gte: startDate };
  if (endDate) dateMatch.date = { ...(dateMatch.date as Record<string, unknown> | undefined), $lte: endDate };

  // Mirrors getCustomerLedger's totals math: totalSold = sum of sale totalPrice in range;
  // totalReceived = sum of payment amounts in range; balance = totalReceived - totalSold (signed).
  const [soldAgg, receivedAgg] = await Promise.all([
    CustomerSaleEntry.aggregate<{ _id: mongoose.Types.ObjectId; sold: number }>([
      { $match: { customerId: { $in: customerIds }, ...dateMatch } },
      { $group: { _id: "$customerId", sold: { $sum: "$totalPrice" } } },
    ]),
    CustomerPayment.aggregate<{ _id: mongoose.Types.ObjectId; received: number }>([
      { $match: { customerId: { $in: customerIds }, ...dateMatch } },
      { $group: { _id: "$customerId", received: { $sum: "$amount" } } },
    ]),
  ]);
  const soldMap = new Map(soldAgg.map((r) => [r._id.toString(), r.sold]));
  const receivedMap = new Map(receivedAgg.map((r) => [r._id.toString(), r.received]));

  return payloads.map((c) => {
    const totalSold = soldMap.get(c.id) ?? 0;
    const totalReceived = receivedMap.get(c.id) ?? 0;
    return { ...c, totalSold, totalReceived, balance: totalReceived - totalSold };
  });
}

export async function getCustomerById(id: string): Promise<CustomerPayload | null> {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const doc = await Customer.findById(id).lean();
  return doc ? toPayload(doc) : null;
}

/** Create customer. Site Manager: uses assigned project. Admin/Super Admin: requires projectId in input. */
export async function createCustomer(
  actor: { userId: string; email: string; role: string },
  input: CreateCustomerInput
): Promise<CustomerPayload> {
  if (!input.name?.trim()) {
    throw new Error("Customer name is required");
  }

  let projectId: string;
  if (actor.role === "site_manager") {
    projectId = (await resolveSiteManagerProjectId(actor.userId, input.projectId)) ?? "";
    if (!projectId) throw new Error("Site Manager must be assigned to this project to create customers");
  } else {
    projectId = input.projectId ?? "";
    if (!projectId || !mongoose.Types.ObjectId.isValid(projectId)) {
      throw new Error("Project is required");
    }
  }

  const customer = await Customer.create({
    projectId,
    name: input.name.trim(),
    phone: (input.phone ?? "").trim(),
    description: (input.description ?? "").trim(),
    totalSold: 0,
    totalReceived: 0,
    balance: 0,
  });

  const actorUser = await User.findById(actor.userId).lean();
  const role = roleDisplay[actor.role as keyof typeof roleDisplay] ?? actor.role;
  await logAudit({
    userId: actor.userId,
    userName: actorUser?.name ?? "Unknown",
    userEmail: actor.email,
    role,
    action: "create",
    module: "customers",
    entityId: customer._id.toString(),
    projectId: customer.projectId?.toString(),
    projectName: await getProjectName(customer.projectId?.toString()),
    description: `Created customer: ${customer.name}`,
    newValue: { name: customer.name },
  });

  return toPayload(customer);
}

export async function updateCustomer(
  actor: { userId: string; email: string; role: string },
  id: string,
  input: UpdateCustomerInput
): Promise<CustomerPayload> {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new Error("Invalid customer ID");
  }

  const target = await Customer.findById(id);
  if (!target) {
    throw new Error("Customer not found");
  }

  const updates: Record<string, unknown> = {};
  if (input.name != null) updates.name = input.name.trim();
  if (input.phone != null) updates.phone = input.phone.trim();
  if (input.description != null) updates.description = input.description.trim();

  const updated = await Customer.findByIdAndUpdate(id, updates, { new: true }).lean();
  if (!updated) throw new Error("Update failed");

  const actorUser = await User.findById(actor.userId).lean();
  const role = roleDisplay[actor.role as keyof typeof roleDisplay] ?? actor.role;
  await logAudit({
    userId: actor.userId,
    userName: actorUser?.name ?? "Unknown",
    userEmail: actor.email,
    role,
    action: "update",
    module: "customers",
    entityId: id,
    projectId: target.projectId?.toString(),
    projectName: await getProjectName(target.projectId?.toString()),
    description: `Updated customer: ${target.name}`,
    oldValue: { name: target.name },
    newValue: { name: updated.name },
  });

  return toPayload(updated);
}

/** Cannot delete a customer who still has a balance, or any sale/payment history. */
export async function deleteCustomer(
  actor: { userId: string; email: string; role: string },
  id: string
): Promise<void> {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new Error("Invalid customer ID");
  }

  const target = await Customer.findById(id);
  if (!target) {
    throw new Error("Customer not found");
  }

  if (target.balance < 0) {
    throw new Error(
      `Cannot delete customer "${target.name}" because they owe ${Math.abs(target.balance).toLocaleString()} PKR. Settle the receivable first.`
    );
  }

  if (target.balance > 0) {
    throw new Error(
      `Cannot delete customer "${target.name}" because they hold an unused credit of ${target.balance.toLocaleString()} PKR. Resolve it first.`
    );
  }

  // Unlike vendors, refuse to leave orphaned sale/payment rows behind.
  const [saleCount, paymentCount] = await Promise.all([
    CustomerSaleEntry.countDocuments({ customerId: id }),
    CustomerPayment.countDocuments({ customerId: id }),
  ]);
  if (saleCount > 0 || paymentCount > 0) {
    const parts: string[] = [];
    if (saleCount > 0) parts.push(`${saleCount} sale entr${saleCount === 1 ? "y" : "ies"}`);
    if (paymentCount > 0) parts.push(`${paymentCount} payment${paymentCount === 1 ? "" : "s"}`);
    throw new Error(
      `Cannot delete customer "${target.name}": referenced in ${parts.join(" and ")}. Delete those first.`
    );
  }

  await Customer.findByIdAndDelete(id);

  const actorUser = await User.findById(actor.userId).lean();
  const role = roleDisplay[actor.role as keyof typeof roleDisplay] ?? actor.role;
  await logAudit({
    userId: actor.userId,
    userName: actorUser?.name ?? "Unknown",
    userEmail: actor.email,
    role,
    action: "delete",
    module: "customers",
    entityId: id,
    projectId: target.projectId?.toString(),
    projectName: await getProjectName(target.projectId?.toString()),
    description: `Deleted customer: ${target.name}`,
    oldValue: { name: target.name },
  });
}
