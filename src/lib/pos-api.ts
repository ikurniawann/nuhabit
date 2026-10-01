/**
 * POS API Client
 * Helper functions for calling POS backend APIs
 */

const API_BASE = '/api/pos';

// Generic fetch wrapper
async function fetchAPI<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || `API error: ${response.status}`);
  }

  return data;
}

// ============ PRODUCTS ============

export interface Product {
  id: string;
  sku: string;
  name: string;
  description?: string;
  category_id?: string;
  category?: { name: string };
  base_price: number;
  cost_price?: number;
  is_active: boolean;
  is_available: boolean;
  image_url?: string;
  xp?: number;
  station?: string;
  /**
   * EPIC-034 Fase B — 'gift_card' = penjualan saldo titipan: nominal diketik
   * kasir (bukan harga katalog) dan kartu terbit saat order lunas.
   * EPIC-039 — 'merchandise' = barang beli-jadi-jual ber-stok (Fase A/B).
   */
  product_kind?: 'regular' | 'gift_card' | 'merchandise';
  warehouse_id?: string;
  warehouse_name?: string;
  /** Stall asal produk — badge katalog/keranjang & struk mode Semua Stall */
  stall_warehouse_id?: string | null;
  stall_code?: string | null;
  stall_name?: string | null;
  variants?: ProductVariant[];
  /** EPIC-039 Fase B — varian merchandise ber-stok per SKU */
  skus?: ProductSku[];
  modifiers?: ProductModifier[];
};

export interface ProductSku {
  id: string;
  sku: string;
  name: string;
  barcode?: string | null;
  price_override?: number | null;
  stock_quantity?: number | null;
  is_active?: boolean;
};

export interface ProductVariant {
  id: string;
  product_id: string;
  name: string;
  group_name: string;
  price_adjustment: number;
  is_active: boolean;
};

export interface ProductModifier {
  id: string;
  modifier_group: {
    id: string;
    name: string;
    min_selection: number;
    max_selection: number;
    modifiers: Array<{
      id: string;
      name: string;
      price_adjustment: number;
    }>;
  };
};

export async function getProducts(params?: { category?: string; search?: string }) {
  const queryString = params ? new URLSearchParams(params as any).toString() : '';
  return fetchAPI<{
    success: boolean;
    data: Product[];
    meta?: {
      stall_scoped?: boolean;
      all_stalls?: boolean;
      warehouse_ids?: string[];
      reason?: string;
      product_count?: number;
      active_mode?: "unset" | "all" | "stall";
    };
  }>(`/products${queryString ? '?' + queryString : ''}`);
}

// ============ CUSTOMERS ============

export interface Customer {
  id: string;
  phone: string;
  name?: string;
  email?: string;
  membership_tier: string;
  ark_coin_balance: number;
  total_xp: number;
  total_spent: number;
  visit_count: number;
  discount?: number; // Discount percentage based on tier
  discount_percent?: number; // Dari konfigurasi crm_membership_tiers (EPIC-011)
  member_type?: 'registered' | 'card';
  nfc_uid?: string | null;
  /** EPIC-043 — customer KOL: order digratiskan otomatis (server validasi + kuota). */
  is_kol?: boolean;
}

export async function getCustomers(params?: { search?: string; phone?: string; nfc_uid?: string }) {
  const queryString = params ? new URLSearchParams(params as any).toString() : '';
  return fetchAPI<{ success: boolean; data: Customer[] }>(`/customers${queryString ? '?' + queryString : ''}`);
}

export async function saveCustomer(customer: Partial<Customer> & { phone: string; enroll_member?: boolean; nfc_uid?: string }) {
  return fetchAPI<{ success: boolean; data: Customer; message: string }>('/customers', {
    method: 'POST',
    body: JSON.stringify(customer),
  });
}

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
  return fetchAPI<{ success: boolean; data: any; error?: string }>('/orders', {
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
  return fetchAPI<{ success: boolean; data: any; error?: string }>(`/orders/${orderId}/splits`, {
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

export async function cancelSplit(orderId: string, splitId: string) {
  return fetchAPI<{ success: boolean; data: any; error?: string }>(`/orders/${orderId}/splits/${splitId}`, {
    method: 'PATCH',
  });
}

// ============ VOID + TABLE MANAGEMENT ============

export async function voidOrder(orderId: string, reason: string, supervisorPin: string) {
  return fetchAPI<{ success: boolean; data: any; error?: string }>(`/orders/${orderId}/void`, {
    method: 'POST',
    body: JSON.stringify({ reason, supervisor_pin: supervisorPin }),
  });
}

export async function moveOrderTable(
  orderId: string,
  newTableId: string | null,
  newOrderType?: string
) {
  return fetchAPI<{ success: boolean; data: any; error?: string }>(`/orders/${orderId}/table`, {
    method: 'PATCH',
    body: JSON.stringify({ table_id: newTableId, order_type: newOrderType }),
  });
}

export async function mergeOrders(
  sourceOrderId: string,
  targetOrderId: string,
  supervisorPin?: string
) {
  return fetchAPI<{ success: boolean; data: any; error?: string }>(
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
  items?: any[];
  splits?: any[];
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
  return fetchAPI<{
    success: boolean;
    data: any;
    error?: string;
    /** EPIC-034 Fase B — kartu yang terbit dari penjualan gift card. */
    gift_cards?: IssuedGiftCardResponse[];
    gift_card_error?: string | null;
  }>('/orders', {
    method: 'POST',
    body: JSON.stringify(order),
  });
}

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
      }>;
    };
    error?: string;
  }>(`/checkouts/${encodeURIComponent(checkoutId)}`);
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
  const search = new URLSearchParams();
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') continue;
      search.set(key, String(value));
    }
  }
  const queryString = search.toString();
  return fetchAPI<{ success: boolean; data: any[] }>(`/orders${queryString ? '?' + queryString : ''}`);
}

export interface PosTable {
  id: string;
  table_number: string;
  name: string;
  label: string;
  capacity: number;
  floor?: string | null;
  area?: string | null;
  status: 'available' | 'occupied' | 'billing' | 'reserved' | 'maintenance' | string;
  qr_code?: string | null;
  is_active: boolean;
  pos_x?: number | null;
  pos_y?: number | null;
  active_order?: {
    id: string;
    order_number?: string;
    status?: string;
    payment_status?: string;
    total_amount: number;
    pre_settled_at?: string | null;
    checkout_id?: string | null;
    sold_from?: string | null;
  } | null;
  active_orders?: Array<{
    id: string;
    order_number?: string;
    status?: string;
    payment_status?: string;
    total_amount: number;
    pre_settled_at?: string | null;
    checkout_id?: string | null;
    sold_from?: string | null;
  }>;
  open_checkouts?: Array<{
    id: string;
    checkout_number?: string | null;
    payment_status?: string | null;
    total_amount: number;
  }>;
  bill_count?: number;
  /** Jumlah tamu duduk di order aktif meja (0 = belum tercatat). */
  guest_count?: number;
}

export async function getPOSTables(params?: { include_inactive?: boolean }) {
  const queryString = params ? new URLSearchParams(params as any).toString() : '';
  return fetchAPI<{ success: boolean; data: PosTable[]; error?: string }>(`/tables${queryString ? '?' + queryString : ''}`);
}

export async function getCustomerFavoriteProducts(customerId: string, products: Product[] = []) {
  // Fetch orders for this customer
  const response = await fetchAPI<{ success: boolean; data: any[] }>(`/orders?customer_id=${customerId}&status=completed&limit=100`);
  
  if (!response.success || !response.data) return [];
  
  // Count product occurrences from order items
  const productCounts: Record<string, number> = {};
  
  response.data.forEach((order: any) => {
    if (order.items && Array.isArray(order.items)) {
      order.items.forEach((item: any) => {
        if (!productCounts[item.product_id]) {
          productCounts[item.product_id] = 0;
        }
        productCounts[item.product_id] += item.quantity;
      });
    }
  });
  
  // Sort by count descending and take top 4
  const topProductIds = Object.entries(productCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 4)
    .map(([id]) => id);
  
  // Return actual product objects that match the IDs
  return products.filter(p => topProductIds.includes(p.id));
}

export async function updateOrderStatus(
  orderId: string,
  status: string,
  additionalData?: { payment_status?: string; payment_method?: string; amount_paid?: number; ark_coins_used?: number; cancelled_reason?: string; nfc_tab_uid?: string; xendit_qr_id?: string; xendit_external_id?: string; payment_method_code?: string; payment_method_name?: string; comp_type?: string; supervisor_pin?: string }
) {
  const response = await fetch(`/api/pos/orders/${orderId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ status, ...additionalData }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || `API error: ${response.status}`);
  }

  return data;
}

export async function updateOrderPayment(
  orderId: string,
  payload: { payment_status: string; payment_method?: string; amount_paid?: number; ark_coins_used?: number }
) {
  const response = await fetch(`/api/pos/orders/${orderId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || `API error: ${response.status}`);
  }

  return data;
}

// ============ DASHBOARD ============

export async function getDashboardStats(
  period?: 'today' | 'week' | 'month',
  range?: { from: string; to: string }
) {
  if (range) {
    return fetchAPI<{ success: boolean; data: any }>(
      `/dashboard?period=custom&date_from=${encodeURIComponent(range.from)}&date_to=${encodeURIComponent(range.to)}`
    );
  }
  return fetchAPI<{ success: boolean; data: any }>(`/dashboard?period=${period || 'today'}`);
}

// ============ TOPUP ============

export async function processTopup(data: {
  customer_id: string;
  amount: number;
  payment_method?: 'qris' | 'credit' | 'cash' | 'foc';
  supervisor_pin?: string;
}) {
  return fetchAPI<{ success: boolean; data: any }>('/topup', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function getTopupStatus(topupId: string) {
  return fetchAPI<{ success: boolean; data: any }>(`/topup/${topupId}/status`);
}

export async function getTopupHistory(params?: { customer_id?: string; limit?: number }) {
  const search = new URLSearchParams();
  if (params?.customer_id) search.set('customer_id', params.customer_id);
  if (params?.limit) search.set('limit', String(params.limit));
  const queryString = search.toString();
  return fetchAPI<{ success: boolean; data: any[] }>(
    `/topup${queryString ? `?${queryString}` : ''}`
  );
}

export async function cancelTopup(topupId: string) {
  return fetchAPI<{ success: boolean; data: any }>(`/topup/${topupId}/cancel`, {
    method: 'POST',
  });
}

// ============ RESERVATIONS ============

export async function getReservations(params?: { date?: string; status?: string }) {
  const search = new URLSearchParams();
  if (params?.date) search.set("date", params.date);
  if (params?.status) search.set("status", params.status);
  const queryString = search.toString();
  return fetchAPI<{ success: boolean; data: any[] }>(
    `/reservations${queryString ? `?${queryString}` : ""}`
  );
}

export async function createReservation(reservation: {
  customer_name: string;
  customer_phone: string;
  reservation_date: string;
  time_slot: string;
  pax_count: number;
  table_id?: string;
  customer_id?: string;
  deposit_amount?: number;
  notes?: string;
  special_requests?: string;
}) {
  return fetchAPI<{ success: boolean; data: any; error?: string }>('/reservations', {
    method: 'POST',
    body: JSON.stringify(reservation),
  });
}

export async function updateReservationStatus(
  reservationId: string,
  status: string,
  additionalData?: { notes?: string }
) {
  return fetchAPI<{ success: boolean; data: any }>(`/reservations/${reservationId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status, ...additionalData }),
  });
}

export async function seatReservation(
  reservationId: string,
  payload?: { table_id?: string | null }
) {
  return fetchAPI<{
    success: boolean;
    data?: {
      reservation: unknown;
      order: { id: string; table_id?: string | null; order_number?: string };
      message?: string;
    };
    error?: string;
  }>(`/reservations/${reservationId}/seat`, {
    method: "POST",
    body: JSON.stringify(payload ?? {}),
  });
}

// ===== Shift Management =====

export interface PosShift {
  id: string;
  shift_number: string;
  cashier_id: string;
  branch_id?: string;
  opened_at: string;
  closed_at?: string;
  opened_by?: string;
  closed_by?: string;
  opening_cash: number;
  closing_cash?: number;
  expected_cash?: number;
  variance?: number;
  total_orders: number;
  total_sales: number;
  total_refunds: number;
  total_cash_sales: number;
  total_qris_sales: number;
  total_debit_sales: number;
  total_credit_sales: number;
  total_ark_coin_sales: number;
  notes?: string;
  status: 'active' | 'closed' | 'cancelled';
}

export interface ShiftSummary {
  total_orders: number;
  total_sales: number;
  opening_cash: number;
  expected_cash: number;
  closing_cash: number;
  variance: number;
  method_breakdown: {
    cash: number;
    qris: number;
    debit: number;
    credit: number;
    ark_coin: number;
  };
}

export async function getCurrentShift(cashierId: string) {
  return fetchAPI<{ success: boolean; data?: PosShift; error?: string }>(
    `/shifts/current?cashier_id=${encodeURIComponent(cashierId)}`
  );
}

export async function openShift(payload: { cashier_id: string; opening_cash: number; notes?: string }) {
  return fetchAPI<{ success: boolean; data?: PosShift; error?: string }>('/shifts', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function closeShift(
  shiftId: string,
  payload: { closing_cash: number; notes?: string }
) {
  return fetchAPI<{ success: boolean; data?: PosShift; summary?: ShiftSummary; error?: string }>(
    `/shifts/${shiftId}/close`,
    { method: 'PATCH', body: JSON.stringify(payload) }
  );
}
