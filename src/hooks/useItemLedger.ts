import { useState, useEffect, useCallback } from "react";
import { listItemLedger, type ApiItemLedgerRow } from "@/services/itemLedgerService";

const DEFAULT_PAGE_SIZE = 12;

export function useItemLedger(
  itemId: string,
  page: number = 1,
  pageSize: number = DEFAULT_PAGE_SIZE
) {
  const [entries, setEntries] = useState<ApiItemLedgerRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!itemId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await listItemLedger(itemId, { page, pageSize });
      setEntries(result.entries);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load ledger");
    } finally {
      setLoading(false);
    }
  }, [itemId, page, pageSize]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { entries, total, loading, error, refetch };
}
