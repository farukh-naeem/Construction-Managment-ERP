import { api } from "./api";

export type InventoryReturnType = "sale_return" | "purchase_return";

export interface ApiInventoryReturn {
  id: string;
  projectId: string;
  type: InventoryReturnType;
  partyId: string;
  partyName: string;
  date: string;
  items: { itemId: string; itemName: string; quantity: number; unit: string; unitPrice: number; totalPrice: number }[];
  totalAmount: number;
  accountId: string;
  accountName: string;
  paymentMethod: "Cash" | "Bank" | "Online";
  referenceId?: string;
  remarks?: string;
}

export interface CreateInventoryReturnInput {
  projectId: string;
  type: InventoryReturnType;
  customerId?: string;
  vendorId?: string;
  date: string;
  items: { itemId: string; quantity: number; unit: string; unitPrice: number }[];
  accountId: string;
  paymentMethod: "Cash" | "Bank" | "Online";
  referenceId?: string;
  remarks?: string;
}

export function listInventoryReturns(projectId?: string | null): Promise<ApiInventoryReturn[]> {
  return api<ApiInventoryReturn[]>(`/api/inventory-returns${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`);
}

export function createInventoryReturn(input: CreateInventoryReturnInput): Promise<ApiInventoryReturn> {
  return api<ApiInventoryReturn>("/api/inventory-returns", { method: "POST", body: JSON.stringify(input) });
}
