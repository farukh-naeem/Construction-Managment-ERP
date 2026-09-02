import { useState, useEffect, useCallback } from "react";
import { listCustomerSales, type ApiCustomerSale } from "@/services/customerSaleService";

export function useCustomerSales(projectId?: string | null) {
  const [sales, setSales] = useState<ApiCustomerSale[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listCustomerSales(projectId ?? undefined);
      setSales(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sales");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { sales, loading, error, refetch };
}
