import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { requireCustomerManageAccess } from "../middleware/rbac.js";
import { list, getOne, create, remove } from "../controllers/customerSalesController.js";

export const customerSaleRoutes = Router();
customerSaleRoutes.use(authMiddleware);

customerSaleRoutes.get("/", list);
customerSaleRoutes.get("/:saleId", getOne);
customerSaleRoutes.post("/", create);
customerSaleRoutes.delete("/:saleId", requireCustomerManageAccess, remove);
