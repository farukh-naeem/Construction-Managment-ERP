import { useCallback, useEffect, useState } from "react";
import { getDieselItem, type ApiConsumableItem } from "@/services/consumableItemsService";

export function useDieselItem(projectId?: string | null) {
  const [dieselItem, setDieselItem] = useState<ApiConsumableItem | null>(null);
  const [loading, setLoading] = useState(false);
  const refetch = useCallback(async () => {
    if (!projectId) { setDieselItem(null); setLoading(false); return; }
    setLoading(true);
    try { setDieselItem(await getDieselItem(projectId)); }
    catch { setDieselItem(null); }
    finally { setLoading(false); }
  }, [projectId]);
  useEffect(() => { void refetch(); }, [refetch]);
  return { dieselItem, loading, refetch };
}
