import { api } from "./api";

export interface ApiConsumptionItem {
  itemId: string;
  itemName: string;
  unit: string;
  quantityUsed: number;
}

export interface ApiStockConsumption {
  id: string;
  projectId: string;
  machineId?: string;
  date: string;
  remarks?: string;
  items: ApiConsumptionItem[];
}

export interface CreateStockConsumptionInput {
  projectId: string;
  date: string;
  remarks?: string;
  items: { itemId: string; unit: string; quantityUsed: number }[];
}

export interface UpdateStockConsumptionInput {
  date?: string;
  remarks?: string;
  items?: { itemId: string; unit: string; quantityUsed: number }[];
}

export async function listStockConsumption(projectId?: string | null): Promise<ApiStockConsumption[]> {
  const url = projectId
    ? `/api/stock-consumption?${new URLSearchParams({ projectId })}`
    : "/api/stock-consumption";
  return api<ApiStockConsumption[]>(url);
}

export async function createStockConsumption(input: CreateStockConsumptionInput): Promise<ApiStockConsumption> {
  return api<ApiStockConsumption>("/api/stock-consumption", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateStockConsumption(
  id: string,
  input: UpdateStockConsumptionInput
): Promise<ApiStockConsumption> {
  return api<ApiStockConsumption>(`/api/stock-consumption/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteStockConsumption(id: string): Promise<void> {
  return api<void>(`/api/stock-consumption/${id}`, { method: "DELETE" });
}
