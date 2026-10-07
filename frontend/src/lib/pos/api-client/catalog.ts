import { fetchAPI, toQueryString, type ApiResult } from "./http";
import type { Order } from "./orders";

// Katalog produk & customer kasir.
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
  }>(`/products${toQueryString(params)}`);
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

/** Customer kasir dengan diskon tier CRM (persen) yang sudah dinormalisasi. */
export interface CustomerWithDiscount extends Customer {
  discount: number;
}

export async function getCustomers(params?: { search?: string; phone?: string; nfc_uid?: string }) {
  return fetchAPI<ApiResult<Customer[]>>(`/customers${toQueryString(params)}`);
}

export async function saveCustomer(customer: Partial<Customer> & { phone: string; enroll_member?: boolean; nfc_uid?: string }) {
  return fetchAPI<{ success: boolean; data: Customer; message: string }>('/customers', {
    method: 'POST',
    body: JSON.stringify(customer),
  });
}

export async function getCustomerFavoriteProducts(customerId: string, products: Product[] = []) {
  const response = await fetchAPI<ApiResult<Order[]>>(`/orders?customer_id=${customerId}&status=completed&limit=100`);
  if (!response.success || !response.data) return [];

  // Jumlah qty per produk dari seluruh item order selesai.
  const productCounts: Record<string, number> = {};
  for (const order of response.data) {
    if (!Array.isArray(order.items)) continue;
    for (const item of order.items) {
      const productId = String(item.product_id);
      productCounts[productId] = (productCounts[productId] ?? 0) + (Number(item.quantity) || 0);
    }
  }

  // Top 4 berdasarkan qty
  const topProductIds = Object.entries(productCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 4)
    .map(([id]) => id);
  
  // Return actual product objects that match the IDs
  return products.filter(p => topProductIds.includes(p.id));
}
