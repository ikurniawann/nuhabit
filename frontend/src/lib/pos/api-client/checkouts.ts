import { fetchAPI } from "./http";
import type { CreateOrderRequest } from "./orders";

// Checkout gabungan multi-stall (kasir pusat).
export interface CreateCheckoutRequest extends CreateOrderRequest {
  payment_status?: 'paid' | 'unpaid';
}

export interface CheckoutResponse {
  checkout_id: string;
  checkout_number: string;
  queue_number: string;
  order_ids: string[];
}

export async function createCheckout(checkout: CreateCheckoutRequest) {
  return fetchAPI<{ success: boolean; data: CheckoutResponse; error?: string }>('/checkouts', {
    method: 'POST',
    body: JSON.stringify(checkout),
  });
}

export async function completeCheckout(
  checkoutId: string,
  tender: {
    payment_method: string;
    amount_paid: number;
    payment_method_code?: string;
    payment_method_name?: string;
    /** PIN supervisor — wajib saat metode bayar FOC (Free of Charge). */
    supervisor_pin?: string;
  }
) {
  return fetchAPI<{ success: boolean; data: { order_ids: string[] }; error?: string }>(
    `/checkouts/${encodeURIComponent(checkoutId)}/complete`,
    { method: 'POST', body: JSON.stringify(tender) }
  );
}

export async function cancelCheckout(checkoutId: string) {
  return fetchAPI<{ success: boolean; data?: { checkout_id: string }; error?: string }>(
    `/checkouts/${encodeURIComponent(checkoutId)}/cancel`,
    { method: 'POST' }
  );
}

export async function getCheckout(checkoutId: string) {
  return fetchAPI<{
    success: boolean;
    data?: {
      id: string;
      checkout_number?: string | null;
      queue_number?: string | null;
      table_id?: string | null;
      payment_status?: string | null;
      customer_id?: string | null;
      notes?: string | null;
      total_amount?: number | string | null;
      order_type?: string | null;
      order_ids?: string[];
      items?: Array<{
        id?: string;
        product_id?: string;
        product_name?: string;
        quantity?: number | string;
        unit_price?: number | string;
        subtotal?: number | string;
        total_amount?: number | string;
        variants?: Array<{ name?: string }>;
        modifiers?: Array<{ name?: string }>;
        station?: string;
        warehouse_id?: string | null;
      }>;
    };
    error?: string;
  }>(`/checkouts/${encodeURIComponent(checkoutId)}`);
}
