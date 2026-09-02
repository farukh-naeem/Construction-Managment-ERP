import { api } from "./api";

export interface ApiConsumableItem {
  id: string;
  projectId: string;
  name: string;
  /** Legacy value only; units are selected per purchase or consumption row. */
  unit?: string;
  currentStock: number;
  totalPurchased: number;
  totalAmount: number;
  totalPaid: number;
  totalPending: number;
}

export interface CreateConsumableItemInput {
  projectId: string;
  name: string;
}

export interface UpdateConsumableItemInput {
  name?: string;
}

export async function listConsumableItems(projectId?: string | null): Promise<ApiConsumableItem[]> {
  const url = projectId
    ? `/api/consumable-items?${new URLSearchParams({ projectId })}`
    : "/api/consumable-items";
  return api<ApiConsumableItem[]>(url);
}

export async function getConsumableItem(id: string): Promise<ApiConsumableItem> {
  return api<ApiConsumableItem>(`/api/consumable-items/${id}`);
}

export async function getDieselItem(projectId: string): Promise<ApiConsumableItem | null> {
  const result = await api<{ item: ApiConsumableItem | null }>(
    `/api/consumable-items/diesel?${new URLSearchParams({ projectId })}`
  );
  return result.item;
}

export async function createConsumableItem(input: CreateConsumableItemInput): Promise<ApiConsumableItem> {
  return api<ApiConsumableItem>("/api/consumable-items", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateConsumableItem(
  id: string,
  input: UpdateConsumableItemInput
): Promise<ApiConsumableItem> {
  return api<ApiConsumableItem>(`/api/consumable-items/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteConsumableItem(id: string): Promise<void> {
  return api<void>(`/api/consumable-items/${id}`, { method: "DELETE" });
}
