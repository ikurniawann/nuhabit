import {
  createSplitOrder,
  getCheckout,
  getCustomerFavoriteProducts,
  getPOSTables,
  openBill,
  saveCustomer,
  updateOrderStatus,
} from "@/lib/pos-api";
import type { Customer, PosTable, Product } from "@/lib/pos-api";

export type { Customer, PosTable, Product };

export interface CashierOrderItem {
  id?: string;
  product_id: string;
  product_name: string;
  quantity: number | string;
  unit_price?: number | string;
  subtotal?: number | string;
  total_amount?: number | string;
  variants?: Array<{ name?: string }>;
  modifiers?: Array<{ name?: string }>;
  station?: string;
  warehouse_id?: string | null;
}

export interface CashierOrder {
  id: string;
  /** Kontak pemesan self-order (tamu) — nama utk struk bila bukan member. */
  contact_name?: string | null;
  contact_phone?: string | null;
  order_number?: string;
  order_type?: string;
  table_id?: string | null;
  customer_id?: string | null;
  notes?: string | null;
  total_amount?: number;
  items?: CashierOrderItem[];
}

export interface PayOpenOrderPayload {
  status?: string;
  payment_status: string;
  payment_method: string;
  amount_paid: number;
  ark_coins_used?: number;
  /** UID gelang ticketing — wajib saat payment_method 'nfc_tab' */
  nfc_tab_uid?: string;
  /** Kode kartu — wajib saat payment_method 'gift_card' (EPIC-034 Fase C) */
  gift_card_code?: string;
  xendit_qr_id?: string;
  xendit_external_id?: string;
  payment_method_code?: string;
  payment_method_name?: string;
  /** PIN supervisor — wajib saat metode bayar FOC (Free of Charge). */
  supervisor_pin?: string;
}

export async function listCashierTables(): Promise<PosTable[]> {
  const res = await getPOSTables();
  if (!res.success) {
    throw new Error(res.error || "Failed to load tables");
  }
  return res.data ?? [];
}

export type CashierCheckout = CashierOrder & {
  checkout_number?: string | null;
  order_ids?: string[];
};

export async function getCashierCheckout(checkoutId: string): Promise<CashierCheckout> {
  const res = await getCheckout(checkoutId);
  if (!res.success || !res.data) {
    throw new Error(res.error || "Failed to load checkout");
  }
  const data = res.data;
  return {
    id: data.id,
    order_number: data.checkout_number || undefined,
    order_type: data.order_type || undefined,
    table_id: data.table_id ?? null,
    customer_id: data.customer_id ?? null,
    notes: data.notes ?? null,
    total_amount: Number(data.total_amount || 0),
    items: (data.items || []).map((item) => ({
      id: item.id,
      product_id: String(item.product_id || ""),
      product_name: String(item.product_name || ""),
      quantity: item.quantity ?? 1,
      unit_price: item.unit_price,
      subtotal: item.subtotal,
      total_amount: item.total_amount,
      variants: item.variants,
      modifiers: item.modifiers,
      station: item.station,
      warehouse_id: item.warehouse_id,
    })),
    checkout_number: data.checkout_number,
    order_ids: data.order_ids,
  };
}

export async function getCashierOrder(orderId: string): Promise<CashierOrder> {
  const response = await fetch(`/api/pos/orders/${orderId}`, { cache: "no-store" });
  const json = await response.json();
  if (!json.success || !json.data) {
    throw new Error(json.error || "Failed to load order");
  }
  return json.data as CashierOrder;
}

export async function payOpenOrder(orderId: string, payload: PayOpenOrderPayload) {
  return updateOrderStatus(orderId, payload.status, {
    payment_status: payload.payment_status,
    payment_method: payload.payment_method,
    amount_paid: payload.amount_paid,
    ark_coins_used: payload.ark_coins_used,
    nfc_tab_uid: payload.nfc_tab_uid,
    xendit_qr_id: payload.xendit_qr_id,
    xendit_external_id: payload.xendit_external_id,
    payment_method_code: payload.payment_method_code,
    payment_method_name: payload.payment_method_name,
  });
}

export async function listCustomerFavoriteProducts(customerId: string, products: Product[] = []) {
  return getCustomerFavoriteProducts(customerId, products);
}

export { saveCustomer, openBill, createSplitOrder };
