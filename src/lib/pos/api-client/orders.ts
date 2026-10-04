import { fetchAPI, toQueryString, type ApiResult } from "./http";
import type { Customer } from "./catalog";

// Order kasir: buat/bayar/split/void/pindah meja/open bill.
export interface SplitWithItems {
  label?: string;
  subtotal?: number;
  tax_amount?: number;
  discount_amount?: number;
  total_amount: number;
  customer_id?: string;
  items?: {
    order_item_index: number;
    quantity: number;
    product_id: string;
    product_name: string;
    unit_price: number;
  }[];
}

export interface SplitBillRequest {
  order_type: 'dine_in' | 'takeaway' | 'delivery' | 'self_order';
  customer_id?: string;
  cashier_id: string;
  server_id?: string;
  table_id?: string;
  /** Jumlah tamu yang duduk (EPIC-038). Kosong → 1 orang, ditegakkan server. */
  guest_count?: number;
  shift_id?: string;
  items: OrderItem[];
  subtotal: number;
  discount_amount?: number;
  discount_reason?: string;
  tax_amount?: number;
  service_charge_amount?: number;
  other_charges_amount?: number;
  charges_breakdown?: Array<{
    code: string;
    name: string;
    kind: string;
    amount: number;
  }>;
  total_amount: number;
  notes?: string;
  special_requests?: string;
  include_tax?: boolean;
  membership_discount_pct?: number;
  splits: SplitWithItems[];
}

export interface SplitDetail {
  id: string;
  label: string;
  split_index: number;
  total_amount: number;
  amount_paid: number;
  change_amount: number;
  tax_amount: number;
  discount_amount: number;
  payment_method?: string;
  status: 'pending' | 'paid' | 'partial' | 'cancelled';
  customer_id?: string;
  ark_coins_used: number;
  paid_at?: string;
  created_at: string;
}

export interface SplitPaymentResult {
  success: boolean;
  split_id: string;
  change: number;
  paid_splits: number;
  total_splits: number;
  error?: string;
}

export async function createSplitOrder(order: SplitBillRequest) {
  return fetchAPI<OrderMutationResult>('/orders', {
    method: 'POST',
    body: JSON.stringify(order),
  });
}

export async function getOrderSplits(orderId: string) {
  return fetchAPI<{
    success: boolean;
    data: {
      splits: SplitDetail[];
      total_paid: number;
      total_remaining: number;
      split_count: number;
      paid_count: number;
    }
  }>(`/orders/${orderId}/splits`);
}

export async function createOrderSplits(
  orderId: string,
  payload: {
    splits: SplitWithItems[];
  }
) {
  return fetchAPI<ApiResult<unknown>>(`/orders/${orderId}/splits`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function paySplit(
  orderId: string,
  splitId: string,
  payload: {
    payment_method: string;
    amount_paid: number;
    ark_coins_used?: number;
    reference_number?: string;
  }
) {
  return fetchAPI<{ success: boolean; data: SplitPaymentResult; error?: string }>(`/orders/${orderId}/splits/${splitId}/pay`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// ============ VOID + TABLE MANAGEMENT ============

export async function voidOrder(orderId: string, reason: string, supervisorPin: string) {
  return fetchAPI<ApiResult<unknown>>(`/orders/${orderId}/void`, {
    method: 'POST',
    body: JSON.stringify({ reason, supervisor_pin: supervisorPin }),
  });
}

export async function moveOrderTable(
  orderId: string,
  newTableId: string | null,
  newOrderType?: string
) {
  return fetchAPI<ApiResult<unknown>>(`/orders/${orderId}/table`, {
    method: 'PATCH',
    body: JSON.stringify({ table_id: newTableId, order_type: newOrderType }),
  });
}

export async function mergeOrders(
  sourceOrderId: string,
  targetOrderId: string,
  supervisorPin?: string
) {
  return fetchAPI<ApiResult<unknown>>(
    `/orders/${sourceOrderId}/merge`,
    {
      method: "POST",
      body: JSON.stringify({
        target_order_id: targetOrderId,
        ...(supervisorPin != null && String(supervisorPin).trim() !== ""
          ? { supervisor_pin: supervisorPin }
          : {}),
      }),
    }
  );
}

export async function transferOrderItems(
  sourceOrderId: string,
  payload: {
    target_table_id: string;
    items: Array<{ order_item_id: string; qty: number }>;
  }
) {
  return fetchAPI<{
    success: boolean;
    data?: {
      source_order_id: string;
      target_order_id: string;
      created_target?: boolean;
      message?: string;
    };
    error?: string;
  }>(`/orders/${sourceOrderId}/transfer-items`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// ============ OPEN BILL ============
export interface OpenBillRequest {
  order_type: 'dine_in' | 'takeaway' | 'delivery' | 'self_order';
  customer_id?: string;
  cashier_id?: string;
  server_id?: string;
  table_id?: string;
  /** Lanjutkan CHK yang sama saat tambah item (termasuk tanpa meja). */
  checkout_id?: string;
  /** Jumlah tamu yang duduk (EPIC-038). Kosong → 1 orang, ditegakkan server. */
  guest_count?: number;
  shift_id?: string;
  items: OrderItem[];
  subtotal: number;
  discount_amount?: number;
  discount_reason?: string;
  manual_discount_type?: 'percent' | 'fixed' | null;
  manual_discount_value?: number | null;
  tax_amount?: number;
  service_charge_amount?: number;
  other_charges_amount?: number;
  charges_breakdown?: Array<{
    code: string;
    name: string;
    kind: string;
    amount: number;
  }>;
  total_amount: number;
  notes?: string;
  special_requests?: string;
  membership_discount_pct?: number;
  promo_discount?: number;
  promo_code?: string;
  offer_discount?: number;
  reuse_unpaid_checkout?: boolean;
}

export async function openBill(payload: OpenBillRequest) {
  return fetchAPI<{ success: boolean; data: Order; error?: string }>('/orders/open-bill', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function preSettleOrder(orderId: string) {
  return fetchAPI<{
    success: boolean;
    data?: { id: string; pre_settled_at?: string | null };
    error?: string;
    message?: string;
  }>(`/orders/${orderId}/pre-settle`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

// ============ ORDERS ============

export interface OrderItem {
  product_id: string;
  sku_id?: string;
  product_name: string;
  product_sku: string;
  variants?: Array<{ name: string; group: string; price: number }>;
  modifiers?: Array<{ name: string; group: string }>;
  quantity: number;
  unit_price: number;
  variant_price_adjustment?: number;
  modifier_price_adjustment?: number;
  subtotal: number;
  total_amount: number;
  station?: string;
  discount_type?: 'percent' | 'fixed' | null;
  discount_value?: number | null;
  discount_amount?: number;
}

export interface Order {
  id: string;
  order_number?: string;
  queue_number?: string | null;
  order_type?: string;
  status?: string;
  payment_status?: string;
  payment_method?: string;
  payment_method_code?: string | null;
  payment_method_name?: string | null;
  customer?: Customer;
  customer_id?: string;
  table?: { table_number?: string | null; qr_code?: string | null } | null;
  cashier_id?: string;
  server_id?: string;
  table_id?: string;
  /** Jumlah tamu yang duduk (EPIC-038). Kosong → 1 orang, ditegakkan server. */
  guest_count?: number;
  subtotal?: number;
  discount_amount?: number;
  discount_reason?: string;
  manual_discount_type?: 'percent' | 'fixed' | null;
  manual_discount_value?: number | null;
  tax_amount?: number;
  service_charge_amount?: number;
  other_charges_amount?: number;
  charges_breakdown?: Array<{
    code: string;
    name: string;
    kind: string;
    amount: number;
  }> | null;
  total_amount?: number;
  amount_paid?: number;
  change_amount?: number;
  ark_coins_used?: number;
  ordered_at?: string;
  completed_at?: string;
  notes?: string;
  special_requests?: string;
  /** Static QRIS self-order: kapan pemesan mengunggah bukti bayar. */
  payment_proof_uploaded_at?: string | null;
  /** Kontak pemesan self-order (tamu, wajib sejak 2026-09-28). */
  contact_name?: string | null;
  contact_phone?: string | null;
  items?: OrderLineItem[];
  splits?: SplitDetail[];
  checkout_id?: string | null;
  checkout_number?: string | null;
  sold_from?: string | null;
  /** Void tracking */
  voided_at?: string;
  voided_by?: string;
  void_reason?: string;
  /** Merge tracking */
  merged_to_order_id?: string;
  merged_from_orders?: string[];
}

/** Baris item order seperti dikembalikan GET /api/pos/orders (pos_order_items). */
export interface OrderLineItem {
  id?: string;
  order_id?: string;
  product_id?: string;
  sku_id?: string | null;
  product_name?: string;
  product_sku?: string;
  quantity?: number;
  unit_price?: number;
  subtotal?: number;
  discount_amount?: number;
  total_amount?: number;
  station?: string | null;
  kitchen_status?: string | null;
  kitchen_notes?: string | null;
  notes?: string | null;
  variants?: unknown;
  modifiers?: unknown;
}

/** Respons POST /orders dan PATCH /orders/:id (bayar, komplimen, batal). */
export interface OrderMutationResult extends ApiResult<(Order & { comp_approved_name?: string | null }) | undefined> {
  /** EPIC-041 — snapshot struk: saldo ARK sesudah potong & total XP sesudah award. */
  ark_balance_after?: number | null;
  xp_total_after?: number | null;
  crm_xp?: { xpAwarded?: number };
}

export interface CreateOrderRequest {
  /** EPIC-043 — 'kol_comp': komplimen KOL (server validasi flag & kuota). */
  comp_type?: string;
  order_type: 'dine_in' | 'takeaway' | 'delivery' | 'self_order';
  customer_id?: string;
  cashier_id: string;
  server_id?: string;
  table_id?: string;
  /** Jumlah tamu yang duduk (EPIC-038). Kosong → 1 orang, ditegakkan server. */
  guest_count?: number;
  items: OrderItem[];
  subtotal: number;
  discount_amount?: number;
  discount_reason?: string;
  manual_discount_type?: 'percent' | 'fixed' | null;
  manual_discount_value?: number | null;
  tax_amount?: number;
  service_charge_amount?: number;
  other_charges_amount?: number;
  charges_breakdown?: Array<{
    code: string;
    name: string;
    kind: string;
    amount: number;
  }>;
  total_amount: number;
  payment_method?: 'cash' | 'qris' | 'debit' | 'credit' | 'ark_coin' | 'nfc_tab' | 'gift_card';
  amount_paid?: number;
  notes?: string;
  special_requests?: string;
  ark_coins_used?: number;
  /** UID gelang ticketing — wajib saat payment_method 'nfc_tab' (EPIC-023) */
  nfc_tab_uid?: string;
  /** Kode kartu — wajib saat payment_method 'gift_card' (EPIC-034 Fase C) */
  gift_card_code?: string;
  /** Pembeli gift card — nomor dipakai kirim kode via WA (EPIC-034 Fase B) */
  gift_card_buyer_name?: string;
  gift_card_buyer_phone?: string;
  /** Server-side recalculation flag (client sends for audit only) */
  include_tax?: boolean;
  /** Membership discount percentage sent for server validation */
  membership_discount_pct?: number;
  /** EPIC-032 C1 — kode promo; server evaluasi & override diskon */
  promo_code?: string;
  /** Link order to active cashier shift */
  shift_id?: string;
  xendit_qr_id?: string;
  xendit_external_id?: string;
  payment_method_code?: string;
  payment_method_name?: string;
  /** PIN supervisor — wajib saat metode bayar FOC (Free of Charge). */
  supervisor_pin?: string;
}

export interface IssuedGiftCardResponse {
  code: string;
  initial_value: number;
  expires_at: string | null;
}

export async function createOrder(order: CreateOrderRequest) {
  return fetchAPI<OrderMutationResult & {
    /** EPIC-034 Fase B — kartu yang terbit dari penjualan gift card. */
    gift_cards?: IssuedGiftCardResponse[];
    gift_card_error?: string | null;
  }>('/orders', {
    method: 'POST',
    body: JSON.stringify(order),
  });
}

export async function getOrders(params?: {
  status?: string;
  customer_id?: string;
  payment_status?: string;
  order_type?: string;
  payment_method?: string;
  date_from?: string;
  date_to?: string;
  q?: string;
  active_only?: boolean;
  limit?: number;
}) {
  return fetchAPI<ApiResult<Order[]>>(`/orders${toQueryString(params)}`);
}

/** `status` boleh kosong: pelunasan open bill hanya mengirim field pembayaran. */
export async function updateOrderStatus(
  orderId: string,
  status: string | undefined,
  additionalData?: { payment_status?: string; payment_method?: string; amount_paid?: number; ark_coins_used?: number; cancelled_reason?: string; nfc_tab_uid?: string; xendit_qr_id?: string; xendit_external_id?: string; payment_method_code?: string; payment_method_name?: string; comp_type?: string; supervisor_pin?: string }
) {
  return fetchAPI<OrderMutationResult>(`/orders/${orderId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status, ...additionalData }),
  });
}
