import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { requireInventoryManageAccess } from "../middleware/rbac.js";
import { list, getOne, getDiesel, bulkCreateLedger, create, update, remove } from "../controllers/consumableItemsController.js";
import { getRunningBill } from "../controllers/consumableRunningBillController.js";

export const consumableItemRoutes = Router();
consumableItemRoutes.use(authMiddleware);

consumableItemRoutes.get("/", list);
consumableItemRoutes.get("/running-bill", getRunningBill);
consumableItemRoutes.get("/diesel", getDiesel);
consumableItemRoutes.post("/bulk-ledger", bulkCreateLedger);
consumableItemRoutes.get("/:id", getOne);
consumableItemRoutes.post("/", create);
consumableItemRoutes.patch("/:id", requireInventoryManageAccess, update);
consumableItemRoutes.delete("/:id", requireInventoryManageAccess, remove);
