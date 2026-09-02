import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { requireMachineryManageAccess } from "../middleware/rbac.js";
import { list, getOne, create, update, remove, runningBillList, bulkCreateLedger } from "../controllers/machinesController.js";
import { machineLedgerRoutes } from "./machineLedger.js";

export const machineRoutes = Router();
machineRoutes.use(authMiddleware);

machineRoutes.get("/", list);
machineRoutes.get("/running-bill", runningBillList);
machineRoutes.post("/bulk-ledger", bulkCreateLedger);
machineRoutes.post("/", create);
machineRoutes.get("/:id", getOne);
machineRoutes.patch("/:id", requireMachineryManageAccess, update);
machineRoutes.delete("/:id", requireMachineryManageAccess, remove);
machineRoutes.use("/:machineId/ledger", machineLedgerRoutes);
