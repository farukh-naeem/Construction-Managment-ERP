import { useState, useEffect, useCallback } from "react";
import { listCustomers, type ApiCustomer } from "@/services/customersService";

export function useCustomers(
  projectId?: string | null,
  startDate?: string | null,
  endDate?: string | null
) {
  const [customers, setCustomers] = useState<ApiCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listCustomers(projectId ?? undefined, startDate ?? undefined, endDate ?? undefined);
      setCustomers(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load customers");
    } finally {
      setLoading(false);
    }
  }, [projectId, startDate, endDate]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { customers, loading, error, refetch };
}
