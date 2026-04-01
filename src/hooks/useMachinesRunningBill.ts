import { useState, useEffect, useCallback } from "react";
import {
  listMachinesRunningBill,
  type ApiRunningBillSummary,
  type ApiMachineRunningBillRow,
  type ListMachinesRunningBillResult,
} from "@/services/machinesService";

const DEFAULT_PAGE_SIZE = 12;

const emptySummary: ApiRunningBillSummary = {
  currentHours: 0,
  previousHours: 0,
  totalHours: 0,
  thisBill: 0,
  previousBill: 0,
  totalAmount: 0,
  advance: 0,
  netAmount: 0,
};

const emptyResult: ListMachinesRunningBillResult = {
  items: [] as ApiMachineRunningBillRow[],
  total: 0,
  periodStart: "",
  periodEnd: "",
  summary: emptySummary,
};

export function useMachinesRunningBill(
  projectId: string | undefined | null,
  periodStart: string,
  periodEnd: string,
  page: number,
  pageSize: number,
  enabled: boolean
) {
  const [result, setResult] = useState<ListMachinesRunningBillResult>(emptyResult);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectivePage = page ?? 1;
  const effectivePageSize = pageSize ?? DEFAULT_PAGE_SIZE;

  const refetch = useCallback(async () => {
    if (!enabled || !projectId || !periodStart || !periodEnd) {
      setResult(emptyResult);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await listMachinesRunningBill({
        projectId,
        periodStart,
        periodEnd,
        page: effectivePage,
        pageSize: effectivePageSize,
      });
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load running bill");
      setResult(emptyResult);
    } finally {
      setLoading(false);
    }
  }, [enabled, projectId, periodStart, periodEnd, effectivePage, effectivePageSize]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return {
    rows: result.items,
    total: result.total,
    summary: result.summary,
    periodStart: result.periodStart,
    periodEnd: result.periodEnd,
    loading,
    error,
    refetch,
  };
}
