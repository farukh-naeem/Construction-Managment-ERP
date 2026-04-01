import { useState, useEffect, useCallback } from "react";
import {
  getCashExpensesReport,
  type CashExpensesReport,
} from "@/services/cashExpensesReportService";

export function useCashExpensesReport(
  projectId: string | undefined,
  startDate: string,
  endDate: string
) {
  const [report, setReport] = useState<CashExpensesReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!projectId || !startDate || !endDate) {
      setReport(null);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await getCashExpensesReport(projectId, startDate, endDate);
      setReport(result);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load cash & expenses report"
      );
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [projectId, startDate, endDate]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { report, loading, error, refetch };
}
