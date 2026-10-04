import {
  getCheckout,
  getCustomerFavoriteProducts,
  getCustomers,
  getPOSTables,
  getProducts,
  openBill,
  saveCustomer,
  updateOrderStatus,
} from "@/lib/pos-api";
import type { Customer, CustomerWithDiscount, PosTable, Product } from "@/lib/pos-api";
import {
  cacheCatalogMeta,
  cacheCustomers,
  cacheProducts,
  getCachedCatalogMeta,
  getCachedCustomers,
  getCachedProducts,
  setLastSyncTimestamp,
} from "@/lib/pos-db";
import type { ActiveStallMode } from "@/lib/pos/pos-sell-stall";

export type { Customer, CustomerWithDiscount, PosTable, Product };

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

export { saveCustomer, openBill };

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export interface CatalogSnapshot {
  products: Product[];
  activeMode: ActiveStallMode | null;
  allStalls: boolean;
  reason: string | null;
  /** Katalog dari cache IndexedDB karena server tidak terjangkau. */
  offline: boolean;
}

/** Katalog kasir: server dulu (lalu di-cache), fallback cache IndexedDB saat offline. */
export async function loadCashierCatalog(): Promise<CatalogSnapshot> {
  try {
    const res = await getProducts();
    const products = res.data || [];
    void cacheProducts(
      products.map((p) => ({
        id: p.id,
        name: p.name,
        sku: p.sku,
        base_price: p.base_price,
        is_active: p.is_active,
        is_available: p.is_available,
        image_url: p.image_url,
        category: p.category,
        variants: p.variants,
        modifiers: p.modifiers,
        xp: p.xp,
        station: p.station,
        product_kind: p.product_kind,
        warehouse_id: p.warehouse_id ?? p.stall_warehouse_id ?? null,
        warehouse_name: p.warehouse_name ?? p.stall_name ?? null,
        stall_warehouse_id: p.stall_warehouse_id ?? p.warehouse_id ?? null,
        stall_code: p.stall_code,
        stall_name: p.stall_name ?? p.warehouse_name ?? null,
      }))
    );
    void cacheCatalogMeta({ active_mode: res.meta?.active_mode ?? null });
    void setLastSyncTimestamp("products");
    return {
      products,
      activeMode: res.meta?.active_mode ?? null,
      allStalls: Boolean(res.meta?.all_stalls),
      reason: res.meta?.reason ?? null,
      offline: false,
    };
  } catch (err) {
    const message = errorMessage(err, "Failed to load products");
    const [cached, meta] = await Promise.all([getCachedProducts(), getCachedCatalogMeta()]).catch(
      () => {
        throw new Error(message);
      }
    );
    if (cached.length === 0) throw new Error(message);
    return {
      products: cached as Product[],
      activeMode: meta?.active_mode ?? null,
      allStalls: false,
      reason: null,
      offline: true,
    };
  }
}

/** Diskon dari konfigurasi tier CRM (server), bukan hardcode. */
export function withCustomerDiscount(customer: Customer): CustomerWithDiscount {
  return { ...customer, discount: Number(customer.discount_percent) || 0 };
}

export async function loadCashierCustomers(): Promise<CustomerWithDiscount[]> {
  try {
    const res = await getCustomers();
    const customers = (res.data || []).map(withCustomerDiscount);
    void cacheCustomers(
      customers.map((c) => ({
        id: c.id,
        name: c.name,
        phone: c.phone,
        membership_tier: c.membership_tier,
        ark_coin_balance: c.ark_coin_balance,
        total_xp: c.total_xp,
        total_spent: c.total_spent,
        visit_count: c.visit_count,
        discount: c.discount,
      }))
    );
    void setLastSyncTimestamp("customers");
    return customers;
  } catch (err) {
    const message = errorMessage(err, "Failed to load customers");
    const cached = await getCachedCustomers().catch(() => {
      throw new Error(message);
    });
    if (cached.length === 0) throw new Error(message);
    return cached as CustomerWithDiscount[];
  }
}

/** Nama stall aktif utk header struk; null bila tidak ada / gagal. */
export async function fetchActiveStallName(): Promise<string | null> {
  try {
    const res = await fetch("/api/auth/stall-options");
    if (!res.ok) return null;
    const json = await res.json();
    return json?.data?.active?.name ?? null;
  } catch {
    return null;
  }
}

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { res, body: await res.json() };
}

export type PromoCheckResult =
  | { ok: false; error: string }
  | { ok: true; kind: "offer"; ruleId: string; offerName: string }
  | { ok: true; kind: "promo"; discount: number };

/** EPIC-032 C2: pratinjau kode promo; final di-hold server saat order dibuat. */
export async function checkPromoCode(input: {
  code: string;
  subtotal: number;
  items: Array<{ product_id: string; amount: number }>;
  customerId: string | null;
}): Promise<PromoCheckResult> {
  const { res, body } = await postJson("/api/pos/promo-check", {
    code: input.code,
    subtotal: input.subtotal,
    items: input.items,
    customer_id: input.customerId,
  });
  if (!res.ok || !body.success) return { ok: false, error: body.error || "Gagal memeriksa kode" };
  if (!body.data.ok) return { ok: false, error: body.data.message || "Kode tidak berlaku" };
  return body.data.kind === "offer"
    ? { ok: true, kind: "offer", ruleId: body.data.rule_id, offerName: body.data.offer_name }
    : { ok: true, kind: "promo", discount: body.data.discount };
}

export async function checkGiftCard(code: string, total: number) {
  const { res, body } = await postJson("/api/pos/gift-card-check", { code, total });
  if (!res.ok) return { ok: false, reason: body.error || "Gagal memeriksa gift card" };
  const data = body.data || {};
  return {
    ok: Boolean(data.ok),
    reason: data.reason,
    balance: data.balance,
    covers: data.covers,
    expiresAt: data.expires_at,
  };
}

export async function checkNfcTab(uid: string, amount: number) {
  const { res, body } = await postJson("/api/ticketing/tab/check", { nfc_uid: uid, amount });
  if (!res.ok) return { ok: false, reason: body.error || "Gagal memeriksa gelang" };
  const data = body.data || {};
  return {
    ok: Boolean(data.ok),
    reason: data.reason,
    contactName: data.contactName,
    paymentMode: data.paymentMode,
    available: data.available,
  };
}

/** QR kartu member (portal /member): token sekali pakai, diperiksa server. */
export async function resolveMemberQr(
  token: string
): Promise<{ customer_id: string; gym?: { message?: string } }> {
  const res = await fetch("/api/pos/member-qr", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) throw new Error(json.error || "QR member tidak valid");
  return json.data;
}

/** Kirim struk via WA; tanpa phone = nomor profil member di server. */
export async function sendReceiptWa(orderId: string, phone?: string): Promise<string | null> {
  const { res, body } = await postJson(
    `/api/pos/orders/${orderId}/send-wa`,
    phone ? { phone } : {}
  );
  if (!res.ok || !body.success) throw new Error(body.error || "Gagal mengirim WA");
  return body.data?.phone ?? null;
}
