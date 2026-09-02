import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { list, create } from "../controllers/inventoryReturnsController.js";

export const inventoryReturnRoutes = Router();
inventoryReturnRoutes.use(authMiddleware);
inventoryReturnRoutes.get("/", list);
inventoryReturnRoutes.post("/", create);
