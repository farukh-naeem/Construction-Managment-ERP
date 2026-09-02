import { useCallback, useEffect, useState } from "react";
import { listInventoryReturns, type ApiInventoryReturn } from "@/services/inventoryReturnService";

export function useInventoryReturns(projectId?: string | null) {
  const [returns, setReturns] = useState<ApiInventoryReturn[]>([]);
  const [loading, setLoading] = useState(false);
  const refetch = useCallback(async () => {
    if (!projectId) { setReturns([]); return; }
    setLoading(true);
    try { setReturns(await listInventoryReturns(projectId)); }
    finally { setLoading(false); }
  }, [projectId]);
  useEffect(() => { void refetch(); }, [refetch]);
  return { returns, loading, refetch };
}
