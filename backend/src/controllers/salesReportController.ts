import { Response } from "express";
import { getSalesReport } from "../services/salesReportService.js";
import type { AuthRequest } from "../middleware/auth.js";

export async function get(req: AuthRequest, res: Response) {
  try {
    const actor = req.user!;
    const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
    const startDate = typeof req.query.startDate === "string" ? req.query.startDate : undefined;
    const endDate = typeof req.query.endDate === "string" ? req.query.endDate : undefined;
    const report = await getSalesReport(
      { userId: actor.userId, role: actor.role },
      projectId,
      { startDate, endDate }
    );
    res.json(report);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to build sales report";
    res.status(500).json({ error: message });
  }
}
