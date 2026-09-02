import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { requireCustomerManageAccess } from "../middleware/rbac.js";
import {
  getCustomerLedgerHandler,
  createPayment,
  deletePayment,
} from "../controllers/customerPaymentsController.js";

export const customerPaymentRoutes = Router({ mergeParams: true });
customerPaymentRoutes.use(authMiddleware);

customerPaymentRoutes.get("/ledger", getCustomerLedgerHandler);
customerPaymentRoutes.post("/payments", createPayment);
customerPaymentRoutes.delete("/payments/:paymentId", requireCustomerManageAccess, deletePayment);
