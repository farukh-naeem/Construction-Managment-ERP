import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { get } from "../controllers/salesReportController.js";

export const salesReportRoutes = Router();
salesReportRoutes.use(authMiddleware);

salesReportRoutes.get("/", get);
