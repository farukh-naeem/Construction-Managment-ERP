import { Response } from "express";
import { getCashExpensesReport } from "../services/cashExpensesReportService.js";
import type { AuthRequest } from "../middleware/auth.js";

export async function getReport(req: AuthRequest, res: Response) {
  try {
    const actor = req.user!;
    const { projectId } = req.params;
    const startDate =
      typeof req.query.startDate === "string" ? req.query.startDate.trim() : "";
    const endDate = typeof req.query.endDate === "string" ? req.query.endDate.trim() : "";
    const today = new Date().toISOString().slice(0, 10);

    const effectiveStart = startDate || today;
    const effectiveEnd = endDate || today;

    if (effectiveStart > effectiveEnd) {
      res
        .status(400)
        .json({ error: "Invalid date range: startDate must be less than or equal to endDate" });
      return;
    }

    const result = await getCashExpensesReport(actor, projectId, effectiveStart, effectiveEnd);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to get cash & expenses report";
    const status =
      message.includes("not found") || message.includes("access denied")
        ? 404
        : message.includes("Invalid") || message.includes("required")
        ? 400
        : 500;
    res.status(status).json({ error: message });
  }
}
