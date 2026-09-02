import mongoose from "mongoose";
import { Vendor } from "../models/Vendor.js";
import { User } from "../models/User.js";
import { ItemLedgerEntry } from "../models/ItemLedgerEntry.js";
import { VendorPayment } from "../models/VendorPayment.js";
import { logAudit, getProjectName } from "./auditService.js";
import { roleDisplay } from "./authService.js";
import { resolveSiteManagerProjectId } from "./projectAccessService.js";
import { InventoryReturn } from "../models/InventoryReturn.js";

export interface VendorPayload {
  id: string;
  projectId: string;
  name: string;
  phone: string;
  description: string;
  totalBilled: number;
  totalPaid: number;
  remaining: number;
  advanceBalance: number;
}

export interface CreateVendorInput {
  projectId: string;
  name: string;
  phone?: string;
  description?: string;
}

export interface UpdateVendorInput {
  name?: string;
  phone?: string;
  description?: string;
}

function toPayload(
  doc: { _id: mongoose.Types.ObjectId; projectId: mongoose.Types.ObjectId; name: string; phone?: string; description?: string; totalBilled?: number; totalPaid?: number; remaining?: number; advanceBalance?: number }
): VendorPayload {
  return {
    id: doc._id.toString(),
    projectId: doc.projectId?.toString() ?? "",
    name: doc.name,
    phone: doc.phone ?? "",
    description: doc.description ?? "",
    totalBilled: doc.totalBilled ?? 0,
    totalPaid: doc.totalPaid ?? 0,
    remaining: doc.remaining ?? 0,
    advanceBalance: doc.advanceBalance ?? 0,
  };
}

export interface ListVendorsOptions {
  /** Inclusive "YYYY-MM-DD" range. When provided, totalBilled/totalPaid/remaining are recomputed
   *  from the underlying ItemLedgerEntry/VendorPayment rows dated within the range, instead of
   *  returning the vendor's all-time cumulative stored fields. */
  startDate?: string;
  endDate?: string;
}

/** List vendors for a project. Site Manager: uses assigned project. Admin/Super Admin: uses projectId param. */
export async function listVendors(
  actor: { userId: string; role: string },
  projectIdParam?: string,
  options?: ListVendorsOptions
): Promise<VendorPayload[]> {
  let projectId: string | undefined;
  if (actor.role === "site_manager") {
    projectId = await resolveSiteManagerProjectId(actor.userId, projectIdParam);
    if (!projectId) return [];
  } else {
    projectId = projectIdParam;
  }
  const query =
    projectId && mongoose.Types.ObjectId.isValid(projectId) ? { projectId } : {};
  const docs = await Vendor.find(query).lean();
  const payloads = docs.map(toPayload);

  const startDate = options?.startDate?.trim() || undefined;
  const endDate = options?.endDate?.trim() || undefined;
  if (!startDate && !endDate) return payloads;

  const vendorIds = docs.map((d) => d._id);
  if (vendorIds.length === 0) return payloads;

  const dateMatch: Record<string, unknown> = {};
  if (startDate) (dateMatch.date as Record<string, unknown>) = { ...(dateMatch.date as Record<string, unknown> | undefined), $gte: startDate };
  if (endDate) dateMatch.date = { ...(dateMatch.date as Record<string, unknown> | undefined), $lte: endDate };

  // Mirrors getVendorLedger's totals math: totalBilled = sum of item totalPrice in range;
  // totalPaid = (ledger paidAmount + advanceGenerated) in range + external VendorPayment amounts
  // in range; remaining = totalBilled - totalPaid, floored at 0 for display.
  const [billedAgg, payAgg, returnAgg] = await Promise.all([
    ItemLedgerEntry.aggregate<{ _id: mongoose.Types.ObjectId; billed: number; paidFromLedger: number }>([
      { $match: { vendorId: { $in: vendorIds }, ...dateMatch } },
      {
        $group: {
          _id: "$vendorId",
          billed: { $sum: "$totalPrice" },
          paidFromLedger: { $sum: { $add: ["$paidAmount", { $ifNull: ["$advanceGenerated", 0] }] } },
        },
      },
    ]),
    VendorPayment.aggregate<{ _id: mongoose.Types.ObjectId; paid: number }>([
      { $match: { vendorId: { $in: vendorIds }, source: { $ne: "advance" }, ...dateMatch } },
      { $group: { _id: "$vendorId", paid: { $sum: "$amount" } } },
    ]),
    InventoryReturn.aggregate<{ _id: mongoose.Types.ObjectId; returned: number }>([
      { $match: { vendorId: { $in: vendorIds }, type: "purchase_return", ...dateMatch } },
      { $group: { _id: "$vendorId", returned: { $sum: "$totalAmount" } } },
    ]),
  ]);
  const billedMap = new Map(billedAgg.map((r) => [r._id.toString(), r]));
  const payMap = new Map(payAgg.map((r) => [r._id.toString(), r.paid]));
  const returnMap = new Map(returnAgg.map((r) => [r._id.toString(), r.returned]));

  return payloads.map((v) => {
    const b = billedMap.get(v.id);
    const returned = returnMap.get(v.id) ?? 0;
    const totalBilled = (b?.billed ?? 0) - returned;
    const totalPaid = (b?.paidFromLedger ?? 0) + (payMap.get(v.id) ?? 0) - returned;
    const remaining = Math.max(0, totalBilled - totalPaid);
    return { ...v, totalBilled, totalPaid, remaining };
  });
}

export async function getVendorById(id: string): Promise<VendorPayload | null> {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const doc = await Vendor.findById(id).lean();
  return doc ? toPayload(doc) : null;
}

/** Create vendor. Site Manager: uses assigned project. Admin/Super Admin: requires projectId in input. */
export async function createVendor(
  actor: { userId: string; email: string; role: string },
  input: CreateVendorInput
): Promise<VendorPayload> {
  if (!input.name?.trim()) {
    throw new Error("Vendor name is required");
  }

  let projectId: string;
  if (actor.role === "site_manager") {
    projectId = (await resolveSiteManagerProjectId(actor.userId, input.projectId)) ?? "";
    if (!projectId) throw new Error("Site Manager must be assigned to this project to create vendors");
  } else {
    projectId = input.projectId ?? "";
    if (!projectId || !mongoose.Types.ObjectId.isValid(projectId)) {
      throw new Error("Project is required");
    }
  }

  const vendor = await Vendor.create({
    projectId,
    name: input.name.trim(),
    phone: (input.phone ?? "").trim(),
    description: (input.description ?? "").trim(),
    totalBilled: 0,
    totalPaid: 0,
    remaining: 0,
  });

  const actorUser = await User.findById(actor.userId).lean();
  const role = roleDisplay[actor.role as keyof typeof roleDisplay] ?? actor.role;
  await logAudit({
    userId: actor.userId,
    userName: actorUser?.name ?? "Unknown",
    userEmail: actor.email,
    role,
    action: "create",
    module: "vendors",
    entityId: vendor._id.toString(),
    projectId: vendor.projectId?.toString(),
    projectName: await getProjectName(vendor.projectId?.toString()),
    description: `Created vendor: ${vendor.name}`,
    newValue: { name: vendor.name },
  });

  return toPayload(vendor);
}

export async function updateVendor(
  actor: { userId: string; email: string; role: string },
  id: string,
  input: UpdateVendorInput
): Promise<VendorPayload> {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new Error("Invalid vendor ID");
  }

  const target = await Vendor.findById(id);
  if (!target) {
    throw new Error("Vendor not found");
  }

  const updates: Record<string, unknown> = {};
  if (input.name != null) updates.name = input.name.trim();
  if (input.phone != null) updates.phone = input.phone.trim();
  if (input.description != null) updates.description = input.description.trim();

  const updated = await Vendor.findByIdAndUpdate(id, updates, { new: true }).lean();
  if (!updated) throw new Error("Update failed");

  const actorUser = await User.findById(actor.userId).lean();
  const role = roleDisplay[actor.role as keyof typeof roleDisplay] ?? actor.role;
  await logAudit({
    userId: actor.userId,
    userName: actorUser?.name ?? "Unknown",
    userEmail: actor.email,
    role,
    action: "update",
    module: "vendors",
    entityId: id,
    projectId: target.projectId?.toString(),
    projectName: await getProjectName(target.projectId?.toString()),
    description: `Updated vendor: ${target.name}`,
    oldValue: { name: target.name },
    newValue: { name: updated.name },
  });

  return toPayload(updated);
}

/** Cannot delete vendor if they have remaining amount (outstanding balance). */
export async function deleteVendor(
  actor: { userId: string; email: string; role: string },
  id: string
): Promise<void> {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new Error("Invalid vendor ID");
  }

  const target = await Vendor.findById(id);
  if (!target) {
    throw new Error("Vendor not found");
  }

  if (target.remaining > 0) {
    throw new Error(
      `Cannot delete vendor "${target.name}" because they have remaining amount of ${target.remaining.toLocaleString()} PKR. Clear the outstanding balance first.`
    );
  }

  if (target.advanceBalance > 0) {
    throw new Error(
      `Cannot delete vendor "${target.name}" because they hold an unused advance of ${target.advanceBalance.toLocaleString()} PKR. Resolve it first.`
    );
  }

  await Vendor.findByIdAndDelete(id);

  const actorUser = await User.findById(actor.userId).lean();
  const role = roleDisplay[actor.role as keyof typeof roleDisplay] ?? actor.role;
  await logAudit({
    userId: actor.userId,
    userName: actorUser?.name ?? "Unknown",
    userEmail: actor.email,
    role,
    action: "delete",
    module: "vendors",
    entityId: id,
    projectId: target.projectId?.toString(),
    projectName: await getProjectName(target.projectId?.toString()),
    description: `Deleted vendor: ${target.name}`,
    oldValue: { name: target.name },
  });
}
