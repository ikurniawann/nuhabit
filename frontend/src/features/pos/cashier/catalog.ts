/**
 * Aturan katalog kasir (murni): kategori, filter, saran pencarian, scan
 * barcode SKU, kunci produk privilege XP, dan baris keranjang per jenis produk.
 */

import type { Product, ProductSku } from "@/lib/pos-api";
import type { PosCartItem } from "@/hooks/use-pos-cart";

export const ALL_FILTER = "All";
const UNCATEGORIZED = "Uncategorized";

/** Alasan stall yang memblokir katalog kosong (gerbang pilih stall). */
const BLOCKING_STALL_REASONS = new Set([
  "all_stalls",
  "multiple_unselected",
  "no_stall",
  "no_stall_assignment",
]);

export function categoryName(product: Product): string {
  return product.category?.name || UNCATEGORIZED;
}

export function catalogCategories(products: Product[]): string[] {
  return [ALL_FILTER, ...new Set(products.map(categoryName))];
}

/** Katalog terisi (mis. kasir pusat mode semua stall) tidak pernah diblokir. */
export function stallBlockedReason(productCount: number, reason: string | null | undefined) {
  if (productCount > 0 || !reason) return null;
  return BLOCKING_STALL_REASONS.has(reason) ? reason : null;
}

export function stallFilterOptions(products: Product[]) {
  const byId = new Map<string, string>();
  for (const product of products) {
    if (!product.warehouse_id || byId.has(product.warehouse_id)) continue;
    byId.set(product.warehouse_id, product.warehouse_name?.trim() || "Stall");
  }
  return [
    { id: ALL_FILTER, label: "Semua stall" },
    ...[...byId.entries()].map(([id, label]) => ({ id, label })),
  ];
}

export interface CatalogFilter {
  stall: string;
  category: string;
  search: string;
}

export function filterCatalog(products: Product[], filter: CatalogFilter): Product[] {
  const search = filter.search.toLowerCase();
  return products.filter(
    (product) =>
      (filter.stall === ALL_FILTER || product.warehouse_id === filter.stall) &&
      (filter.category === ALL_FILTER || categoryName(product) === filter.category) &&
      (product.name || "").toLowerCase().includes(search)
  );
}

/** Maksimal 8 saran, cocok di nama atau SKU. */
export function searchSuggestions(products: Product[], term: string): Product[] {
  const query = term.trim().toLowerCase();
  if (!query) return [];
  return products
    .filter(
      (product) =>
        (product.name || "").toLowerCase().includes(query) ||
        (product.sku || "").toLowerCase().includes(query)
    )
    .slice(0, 8);
}

/**
 * EPIC-039 Fase B: scanner mengetik kode utuh. Input yang persis sama dengan
 * barcode/kode SKU varian aktif langsung menunjuk varian itu (min 4 karakter
 * supaya pencarian nama biasa tidak terganggu).
 */
export function findSkuByScan(
  products: Product[],
  term: string
): { product: Product; sku: ProductSku } | null {
  const code = term.trim().toLowerCase();
  if (code.length < 4) return null;
  for (const product of products) {
    const sku = (product.skus ?? []).find(
      (candidate) =>
        candidate.is_active !== false &&
        ((candidate.barcode || "").toLowerCase() === code ||
          (candidate.sku || "").toLowerCase() === code)
    );
    if (sku) return { product, sku };
  }
  return null;
}

/** Cara produk masuk keranjang: langsung, atau lewat dialog dulu. */
export type CatalogAddKind = "gift_card" | "merch_sku" | "customize" | "simple";

export function catalogAddKind(product: Product): CatalogAddKind {
  // EPIC-034 Fase B: harga gift card diketik kasir, bukan dari katalog.
  if (product.product_kind === "gift_card") return "gift_card";
  // EPIC-039 Fase B: merchandise ber-varian wajib pilih SKU (stok per varian).
  if (
    product.product_kind === "merchandise" &&
    (product.skus ?? []).some((sku) => sku.is_active !== false)
  ) {
    return "merch_sku";
  }
  if (product.variants?.length || product.modifiers?.length) return "customize";
  return "simple";
}

/** Produk privilege member (EPIC-011 Fase C): butuh lifetime XP >= min_xp. */
export function productXpLock(
  product: Product,
  customer: { total_xp?: number | string } | null,
  xpEnabled: boolean
) {
  const minXp = Number((product as { min_xp?: number | string | null }).min_xp) || 0;
  const customerXp = Number(customer?.total_xp) || 0;
  const locked = xpEnabled && minXp > 0 && (!customer || customerXp < minXp);
  return { minXp, customerXp, locked };
}

export function productXpLockMessage(lock: { minXp: number; customerXp: number }, hasCustomer: boolean) {
  return hasCustomer
    ? `Produk khusus member ≥ ${lock.minXp} XP (XP member: ${lock.customerXp})`
    : `Produk khusus member ≥ ${lock.minXp} XP — pilih member dulu`;
}

/** XP tampilan: dari katalog, atau angka stabil 1..100 dari id produk. */
export function displayXp(product: Product): number {
  if (product.xp != null) return product.xp;
  const sum = product.id.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return (Math.abs(sum) % 100) + 1;
}

export type CatalogLine = Omit<PosCartItem, "warehouse_id" | "warehouse_name">;

/** Baris keranjang dasar; `extra` menimpa field default. */
export function catalogLine(product: Product, extra: Partial<CatalogLine> = {}): CatalogLine {
  return {
    id: product.id,
    productId: product.id,
    name: product.name,
    price: product.base_price,
    quantity: 1,
    imageUrl: product.image_url,
    station: product.station,
    stallName: product.stall_name ?? product.warehouse_name ?? undefined,
    ...extra,
  };
}

/** id unik per nominal: dua nominal berbeda = dua kartu, jangan digabung. */
export function giftCardLine(
  product: Product,
  values: { nominal: number; quantity: number },
  formatCurrency: (value: number) => string
): CatalogLine {
  return catalogLine(product, {
    id: `${product.id}-${values.nominal}`,
    name: `${product.name} ${formatCurrency(values.nominal)}`,
    price: values.nominal,
    quantity: values.quantity,
  });
}

/** id komposit per SKU; harga = override varian ?? harga produk. */
export function merchSkuLine(product: Product, sku: ProductSku): CatalogLine {
  return catalogLine(product, {
    id: `${product.id}::sku:${sku.id}`,
    skuId: sku.id,
    skuCode: sku.sku,
    name: `${product.name} — ${sku.name}`,
    price: sku.price_override ?? product.base_price,
  });
}
