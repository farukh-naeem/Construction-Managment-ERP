import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { requireCustomerManageAccess } from "../middleware/rbac.js";
import { list, getOne, create, update, remove } from "../controllers/customersController.js";

export const customerRoutes = Router();
customerRoutes.use(authMiddleware);

customerRoutes.get("/", list);
customerRoutes.get("/:id", getOne);
customerRoutes.post("/", create);
customerRoutes.patch("/:id", requireCustomerManageAccess, update);
customerRoutes.delete("/:id", requireCustomerManageAccess, remove);
