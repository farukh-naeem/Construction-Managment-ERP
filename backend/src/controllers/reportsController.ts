import type { Response } from "express";
import type { AuthRequest } from "../middleware/auth.js";
import { getDailyProgressReport } from "../services/reportsService.js";

export async function dailyProgress(req: AuthRequest, res: Response) {
  try {
    const actor = req.user!;
    const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
    const date = typeof req.query.date === "string" ? req.query.date : undefined;
    res.json(await getDailyProgressReport({ userId: actor.userId, role: actor.role }, projectId, date));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load daily progress report";
    res.status(message.includes("required") || message.includes("YYYY-MM-DD") ? 400 : message.includes("not found") ? 404 : 500).json({ error: message });
  }
}
