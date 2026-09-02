import { Response, NextFunction } from "express";
import type { UserRole } from "../models/User.js";
import type { AuthRequest } from "./auth.js";

/** Super Admin can manage all roles; Admin can manage only Site Manager */
export function canManageUser(actorRole: UserRole, targetRole: UserRole): boolean {
  if (actorRole === "super_admin") return true;
  if (actorRole === "admin" && targetRole === "site_manager") return true;
  return false;
}

/** Require actor to be Admin or Super Admin (for user management routes) */
export function requireUserManagementAccess(req: AuthRequest, res: Response, next: NextFunction) {
  const role = req.user?.role;
  if (role !== "super_admin" && role !== "admin") {
    res.status(403).json({ error: "Forbidden: user management access required" });
    return;
  }
  next();
}

/** Require actor to be Admin or Super Admin (for project create) */
export function requireProjectCreateAccess(req: AuthRequest, res: Response, next: NextFunction) {
  const role = req.user?.role;
  if (role !== "super_admin" && role !== "admin") {
    res.status(403).json({ error: "Forbidden: project create access required" });
    return;
  }
  next();
}

/** Require actor to be Admin or Super Admin (for project edit) */
export function requireProjectEditAccess(req: AuthRequest, res: Response, next: NextFunction) {
  const role = req.user?.role;
  if (role !== "super_admin" && role !== "admin") {
    res.status(403).json({ error: "Forbidden: project edit access required" });
    return;
  }
  next();
}

/** Require actor to be Super Admin only (for project delete) */
export function requireProjectDeleteAccess(req: AuthRequest, res: Response, next: NextFunction) {
  const role = req.user?.role;
  if (role !== "super_admin") {
    res.status(403).json({ error: "Forbidden: project delete access required" });
    return;
  }
  next();
}

/** Require actor to be Admin or Super Admin (for contractor/vendor edit/delete) */
export function requireContractorManageAccess(req: AuthRequest, res: Response, next: NextFunction) {
  const role = req.user?.role;
  if (role !== "super_admin" && role !== "admin") {
    res.status(403).json({ error: "Forbidden: contractor edit/delete requires Admin or Super Admin" });
    return;
  }
  next();
}

/** Require actor to be Admin or Super Admin (for vendor edit/delete) */
export function requireVendorManageAccess(req: AuthRequest, res: Response, next: NextFunction) {
  const role = req.user?.role;
  if (role !== "super_admin" && role !== "admin") {
    res.status(403).json({ error: "Forbidden: vendor edit/delete requires Admin or Super Admin" });
    return;
  }
  next();
}

/** Require actor to be Admin or Super Admin (for expense edit/delete) */
export function requireExpenseManageAccess(req: AuthRequest, res: Response, next: NextFunction) {
  const role = req.user?.role;
  if (role !== "super_admin" && role !== "admin") {
    res.status(403).json({ error: "Forbidden: expense edit/delete requires Admin or Super Admin" });
    return;
  }
  next();
}

/** Require actor to be Admin or Super Admin (for consumable item / ledger / consumption edit/delete) */
export function requireInventoryManageAccess(req: AuthRequest, res: Response, next: NextFunction) {
  const role = req.user?.role;
  if (role !== "super_admin" && role !== "admin") {
    res.status(403).json({ error: "Forbidden: edit/delete requires Admin or Super Admin" });
    return;
  }
  next();
}

/** Require actor to be Admin or Super Admin (for employee payment edit/delete; Site Manager is entry-only) */
export function requireEmployeeManageAccess(req: AuthRequest, res: Response, next: NextFunction) {
  const role = req.user?.role;
  if (role !== "super_admin" && role !== "admin") {
    res.status(403).json({ error: "Forbidden: edit/delete employee payments requires Admin or Super Admin" });
    return;
  }
  next();
}

/** Require actor to be Admin or Super Admin (for machinery edit/delete and ledger entry delete) */
export function requireMachineryManageAccess(req: AuthRequest, res: Response, next: NextFunction) {
  const role = req.user?.role;
  if (role !== "super_admin" && role !== "admin") {
    res.status(403).json({ error: "Forbidden: machinery edit/delete requires Admin or Super Admin" });
    return;
  }
  next();
}

/** Require actor to be Admin or Super Admin (for bank accounts and transactions) */
export function requireBankAccountAccess(req: AuthRequest, res: Response, next: NextFunction) {
  const role = req.user?.role;
  if (role !== "super_admin" && role !== "admin") {
    res.status(403).json({ error: "Forbidden: Bank & Accounts access requires Admin or Super Admin" });
    return;
  }
  next();
}

/** Require actor to be Super Admin only (for bank account edit/delete and transaction mutations) */
export function requireBankAccountManageAccess(req: AuthRequest, res: Response, next: NextFunction) {
  const role = req.user?.role;
  if (role !== "super_admin") {
    res.status(403).json({ error: "Forbidden: edit/delete requires Super Admin" });
    return;
  }
  next();
}

/** Require actor to be Admin or Super Admin (for customer / sale / payment edit/delete) */
export function requireCustomerManageAccess(req: AuthRequest, res: Response, next: NextFunction) {
  const role = req.user?.role;
  if (role !== "super_admin" && role !== "admin") {
    res.status(403).json({ error: "Forbidden: customer edit/delete requires Admin or Super Admin" });
    return;
  }
  next();
}
