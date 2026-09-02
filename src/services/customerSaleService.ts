import { api } from "./api";
import type { PaymentMethod } from "./customerPaymentService";

export interface ApiCustomerSaleLine {
  id: string;
  itemId: string;
  itemName: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalPrice: number;
  remarks?: string;
}

export interface ApiCustomerSale {
  saleId: string;
  projectId: string;
  customerId: string;
  customerName: string;
  date: string;
  remarks?: string;
  items: ApiCustomerSaleLine[];
  totalAmount: number;
  /** Sum of payments linked to this sale (0 when recorded unpaid). */
  paidAmount: number;
}

export interface CreateCustomerSaleInput {
  projectId: string;
  customerId: string;
  date: string;
  remarks?: string;
  items: { itemId: string; quantity: number; unit: string; unitPrice: number; remarks?: string }[];
  /** Optional. When present, accountId is required so the inflow can be tracked. */
  payment?: {
    amount: number;
    paymentMethod: PaymentMethod;
    accountId: string;
    referenceId?: string;
    remarks?: string;
  };
}

export async function listCustomerSales(projectId?: string | null): Promise<ApiCustomerSale[]> {
  const params = new URLSearchParams();
  if (projectId) params.set("projectId", projectId);
  const q = params.toString();
  return api<ApiCustomerSale[]>(`/api/customer-sales${q ? `?${q}` : ""}`);
}

export async function createCustomerSale(input: CreateCustomerSaleInput): Promise<ApiCustomerSale> {
  return api<ApiCustomerSale>("/api/customer-sales", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function deleteCustomerSale(saleId: string): Promise<void> {
  return api<void>(`/api/customer-sales/${saleId}`, {
    method: "DELETE",
  });
}
