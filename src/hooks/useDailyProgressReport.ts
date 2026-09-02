import { useCallback, useEffect, useState } from "react";
import { getDailyProgressReport, type ApiDailyProgressReport } from "@/services/reportsService";

export function useDailyProgressReport(projectId?: string | null, date?: string) {
  const [report, setReport] = useState<ApiDailyProgressReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refetch = useCallback(async () => {
    if (!projectId || !date) { setReport(null); setError(null); setLoading(false); return; }
    setLoading(true); setError(null);
    try { setReport(await getDailyProgressReport(projectId, date)); }
    catch (err) { setError(err instanceof Error ? err.message : "Failed to load report"); setReport(null); }
    finally { setLoading(false); }
  }, [projectId, date]);
  useEffect(() => { void refetch(); }, [refetch]);
  return { report, loading, error, refetch };
}
