import { useState, useEffect, useCallback } from "react";
import { getSalesReport, type ApiSalesReport } from "@/services/salesReportService";

export function useSalesReport(
  projectId?: string | null,
  startDate?: string | null,
  endDate?: string | null
) {
  const [report, setReport] = useState<ApiSalesReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!projectId) {
      setReport(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await getSalesReport({ projectId, startDate, endDate });
      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sales report");
    } finally {
      setLoading(false);
    }
  }, [projectId, startDate, endDate]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { report, loading, error, refetch };
}
