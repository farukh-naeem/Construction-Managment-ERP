import { useState, useEffect, useCallback } from "react";
import {
  listExpenses,
  listExpenseCategories,
  type ApiExpense,
  type ListExpensesParams,
} from "@/services/expensesService";

export interface UseExpensesParams {
  projectId?: string | null;
  search?: string;
  category?: string;
  page?: number;
  pageSize?: number;
  startDate?: string;
  endDate?: string;
}

export interface UseExpensesResult {
  expenses: ApiExpense[];
  total: number;
  totalAmount: number;
  previousTotal: number;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useExpenses(params: UseExpensesParams = {}): UseExpensesResult {
  const {
    projectId = null,
    search = "",
    category = "all",
    page = 1,
    pageSize = 12,
    startDate,
    endDate,
  } = params;

  const [expenses, setExpenses] = useState<ApiExpense[]>([]);
  const [total, setTotal] = useState(0);
  const [totalAmount, setTotalAmount] = useState(0);
  const [previousTotal, setPreviousTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const listParams: ListExpensesParams = {
        projectId: projectId ?? undefined,
        search: search?.trim() || undefined,
        category: category === "all" ? undefined : category,
        page,
        pageSize,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      };
      const result = await listExpenses(listParams);
      setExpenses(result.expenses);
      setTotal(result.total);
      setTotalAmount(result.totalAmount ?? 0);
      setPreviousTotal(result.previousTotal ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load expenses");
    } finally {
      setLoading(false);
    }
  }, [projectId, search, category, page, pageSize, startDate, endDate]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { expenses, total, totalAmount, previousTotal, loading, error, refetch };
}

/** refreshTrigger: increment to force refetch (e.g. after add/edit expense with new category). */
export function useExpenseCategories(projectId?: string | null, refreshTrigger?: number): string[] {
  const [categories, setCategories] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    listExpenseCategories(projectId)
      .then((list) => {
        if (!cancelled) setCategories(list);
      })
      .catch(() => {
        if (!cancelled) setCategories([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, refreshTrigger]);

  return categories;
}
