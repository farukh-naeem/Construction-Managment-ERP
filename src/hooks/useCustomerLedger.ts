import { useState, useEffect, useCallback } from "react";
import { getCustomerLedger, type ApiCustomerLedger } from "@/services/customerPaymentService";

const DEFAULT_PAGE_SIZE = 12;

export function useCustomerLedger(
  customerId: string,
  page: number = 1,
  pageSize: number = DEFAULT_PAGE_SIZE,
  startDate?: string,
  endDate?: string
) {
  const [ledger, setLedger] = useState<ApiCustomerLedger | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!customerId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getCustomerLedger(customerId, { page, pageSize, startDate, endDate });
      setLedger(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load customer ledger");
    } finally {
      setLoading(false);
    }
  }, [customerId, page, pageSize, startDate, endDate]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { ledger, loading, error, refetch };
}
