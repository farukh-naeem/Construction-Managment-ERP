import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { dailyProgress } from "../controllers/reportsController.js";

export const reportsRoutes = Router();
reportsRoutes.use(authMiddleware);
reportsRoutes.get("/daily-progress", dailyProgress);
