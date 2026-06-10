import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { requireProjectCreateAccess, requireProjectManageAccess } from "../middleware/rbac.js";
import { list, create, update, remove, getSummary } from "../controllers/projectsController.js";
import { getReport as getCashExpensesReport, getEntityLedger as getCashExpensesEntityLedger } from "../controllers/cashExpensesReportController.js";

export const projectRoutes = Router();
projectRoutes.use(authMiddleware);

projectRoutes.get("/", list);
projectRoutes.get("/:projectId/summary", getSummary);
projectRoutes.get("/:projectId/cash-expenses-report", getCashExpensesReport);
projectRoutes.get("/:projectId/cash-expenses-report/ledger", getCashExpensesEntityLedger);
projectRoutes.post("/", requireProjectCreateAccess, create);
projectRoutes.patch("/:id", requireProjectManageAccess, update);
projectRoutes.delete("/:id", requireProjectManageAccess, remove);
