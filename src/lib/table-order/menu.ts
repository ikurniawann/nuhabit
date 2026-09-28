/**
 * Self-order meja (QR) — bentuk data menu yang dipakai halaman publik
 * `/table-order/[tableCode]` dan API `/api/table-order/products`.
 *
 * Murni (tanpa I/O) supaya bisa dipakai di server maupun klien dan mudah
 * diuji. Sumber data tetap `pos.pos_products` (katalog yang sama dengan kasir
 * & KDS) — self-order TIDAK punya katalog terpisah.
 */

import { posStationLabel } from "@/lib/pos/kitchen-station";

export type TableOrderVariant = {
  id: string;
  name: string;
  priceAdjustment: number;
};

/** Add-on (pos_modifiers) — mis. Extra Shot, Oat Milk. Harga tambahan per unit. */
export type TableOrderModifier = {
  id: string;
  name: string;
  priceAdjustment: number;
};

/**
 * Grup add-on per produk (pos_modifier_groups via pos_product_modifiers).
 * minSelection ≥ 1 = wajib pilih; maxSelection = batas opsi terpilih
 * (0/kosong diperlakukan 1, sama seperti popup kasir).
 */
export type TableOrderModifierGroup = {
  id: string;
  name: string;
  minSelection: number;
  maxSelection: number;
  modifiers: TableOrderModifier[];
};

/** Add-on terpilih lengkap dengan nama grupnya (untuk item order & KDS). */
export type SelectedModifier = TableOrderModifier & { groupName: string };

export type TableOrderProduct = {
  id: string;
  sku: string;
  name: string;
  description: string;
  price: number;
  xp: number;
  /** Station KDS (lowercase: kitchen/bar/…) — dikirim balik saat order. */
  station: string;
  stationLabel: string;
  image: string | null;
  categoryId: string | null;
  categoryName: string;
  prepTimeMinutes: number;
  /** Produk khusus member (EPIC-011 Fase C) — 0 = bebas. */
  minXp: number;
  variants: TableOrderVariant[];
  modifierGroups: TableOrderModifierGroup[];
  /** Punya >1 varian atau add-on → buka sheet pilihan & tampil "Bisa custom". */
  customizable: boolean;
};

export type TableOrderCategory = {
  id: string;
  name: string;
  count: number;
};

export type ProductRowInput = {
  id: string;
  sku?: string | null;
  name: string;
  description?: string | null;
  base_price?: number | string | null;
  image_url?: string | null;
  xp_points?: number | string | null;
  station?: string | null;
  prep_time_minutes?: number | string | null;
  min_xp?: number | string | null;
  category_id?: string | null;
  category_name?: string | null;
  variants?:
    | {
        id: string;
        name: string;
        price_adjustment?: number | string | null;
        is_active?: boolean | null;
      }[]
    | string
    | null;
  modifier_groups?:
    | {
        id: string;
        name: string;
        min_selection?: number | string | null;
        max_selection?: number | string | null;
        modifiers?: { id: string; name: string; price_adjustment?: number | string | null }[] | null;
      }[]
    | string
    | null;
};

export const UNCATEGORIZED_ID = "__lainnya";
export const UNCATEGORIZED_LABEL = "Lainnya";

export function toNumber(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function parseJsonArray<T>(raw: T[] | string | null | undefined): T[] {
  if (!raw) return [];
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return Array.isArray(raw) ? raw : [];
}

function parseModifierGroups(raw: ProductRowInput["modifier_groups"]): TableOrderModifierGroup[] {
  return parseJsonArray(raw)
    .filter((group) => group && group.id)
    .map((group) => ({
      id: String(group.id),
      name: String(group.name || "").trim() || "Tambahan",
      minSelection: Math.max(0, Math.round(toNumber(group.min_selection))),
      maxSelection: Math.max(1, Math.round(toNumber(group.max_selection)) || 1),
      modifiers: (group.modifiers ?? [])
        .filter((modifier) => modifier && modifier.id)
        .map((modifier) => ({
          id: String(modifier.id),
          name: String(modifier.name || "").trim(),
          priceAdjustment: toNumber(modifier.price_adjustment),
        })),
    }))
    .filter((group) => group.modifiers.length > 0);
}

function parseVariants(raw: ProductRowInput["variants"]) {
  if (!raw) return [];
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return raw;
}

export function normalizeTableOrderProduct(row: ProductRowInput): TableOrderProduct {
  const variants = parseVariants(row.variants)
    .filter((variant) => variant && variant.id && variant.is_active !== false)
    .map((variant) => ({
      id: String(variant.id),
      name: String(variant.name || "").trim() || "Regular",
      priceAdjustment: toNumber(variant.price_adjustment),
    }));

  const modifierGroups = parseModifierGroups(row.modifier_groups);
  const station = String(row.station || "kitchen").trim().toLowerCase() || "kitchen";
  const image = String(row.image_url || "").trim();

  return {
    id: row.id,
    sku: String(row.sku || row.id),
    name: row.name,
    description: String(row.description || "").trim(),
    price: Math.max(0, toNumber(row.base_price)),
    xp: Math.max(0, Math.round(toNumber(row.xp_points))),
    station,
    stationLabel: posStationLabel(station),
    image: image || null,
    categoryId: row.category_id || null,
    categoryName: String(row.category_name || "").trim() || UNCATEGORIZED_LABEL,
    prepTimeMinutes: Math.max(0, Math.round(toNumber(row.prep_time_minutes))),
    minXp: Math.max(0, Math.round(toNumber(row.min_xp))),
    variants,
    modifierGroups,
    customizable: variants.length > 1 || modifierGroups.length > 0,
  };
}

/** Varian yang dipakai kalau pemesan tidak memilih (produk tanpa varian → null). */
export function defaultVariant(product: Pick<TableOrderProduct, "variants">) {
  return product.variants[0] ?? null;
}

export function resolveVariant(
  product: Pick<TableOrderProduct, "variants">,
  variantId?: string | null
): TableOrderVariant | null {
  if (product.variants.length === 0) return null;
  if (!variantId) return product.variants[0];
  return product.variants.find((variant) => variant.id === variantId) ?? null;
}

export function unitPriceFor(
  product: Pick<TableOrderProduct, "price">,
  variant: TableOrderVariant | null,
  modifiers: Pick<TableOrderModifier, "priceAdjustment">[] = []
) {
  const addOns = modifiers.reduce((sum, modifier) => sum + modifier.priceAdjustment, 0);
  return Math.max(0, Math.round(product.price + (variant?.priceAdjustment ?? 0) + addOns));
}

/**
 * Validasi pilihan add-on terhadap katalog (dipakai klien DAN server — server
 * wajib, karena id dari HP tidak dipercaya):
 * - setiap id harus milik salah satu grup produk ini;
 * - tidak ada id ganda;
 * - jumlah per grup ≤ maxSelection, dan grup wajib (minSelection) terpenuhi.
 */
export function resolveModifiers(
  product: Pick<TableOrderProduct, "name"> & { modifierGroups?: TableOrderModifierGroup[] },
  modifierIds: readonly string[] = []
): { ok: true; selected: SelectedModifier[] } | { ok: false; error: string } {
  const groups = product.modifierGroups ?? [];
  const ids = modifierIds.map(String);
  if (new Set(ids).size !== ids.length) {
    return { ok: false, error: `Tambahan ${product.name} dipilih ganda — pilih ulang` };
  }
  const selected: SelectedModifier[] = [];
  const perGroup = new Map<string, number>();
  for (const id of ids) {
    const group = groups.find((g) => g.modifiers.some((m) => m.id === id));
    if (!group) return { ok: false, error: `Tambahan ${product.name} tidak dikenal — pilih ulang` };
    const modifier = group.modifiers.find((m) => m.id === id)!;
    selected.push({ ...modifier, groupName: group.name });
    perGroup.set(group.id, (perGroup.get(group.id) ?? 0) + 1);
  }
  for (const group of groups) {
    const count = perGroup.get(group.id) ?? 0;
    if (count > group.maxSelection) {
      return { ok: false, error: `${group.name}: maksimal ${group.maxSelection} pilihan` };
    }
    if (count < group.minSelection) {
      return { ok: false, error: `${group.name}: wajib pilih ${group.minSelection}` };
    }
  }
  return { ok: true, selected };
}

/**
 * Kategori dibangun dari produk yang benar-benar bisa dijual (kategori
 * kosong tidak ditampilkan), urutan mengikuti urutan produk masuk — API
 * sudah mengurutkan berdasarkan `pos_categories.display_order`.
 */
export function buildCategories(products: TableOrderProduct[]): TableOrderCategory[] {
  const map = new Map<string, TableOrderCategory>();
  for (const product of products) {
    const id = product.categoryId || UNCATEGORIZED_ID;
    const existing = map.get(id);
    if (existing) {
      existing.count += 1;
    } else {
      map.set(id, { id, name: product.categoryName, count: 1 });
    }
  }
  return [...map.values()];
}

export function filterProducts(
  products: TableOrderProduct[],
  input: { query?: string; categoryId?: string | null }
) {
  const term = String(input.query || "").trim().toLowerCase();
  const categoryId = input.categoryId || null;
  return products.filter((product) => {
    const productCategory = product.categoryId || UNCATEGORIZED_ID;
    if (categoryId && productCategory !== categoryId) return false;
    if (!term) return true;
    return `${product.name} ${product.description} ${product.categoryName}`
      .toLowerCase()
      .includes(term);
  });
}

export type MenuSection = { category: TableOrderCategory; products: TableOrderProduct[] };

/** Daftar menu per seksi kategori (gaya GoFood: judul seksi + baris produk). */
export function groupBySection(
  products: TableOrderProduct[],
  categories: TableOrderCategory[]
): MenuSection[] {
  const byCategory = new Map<string, TableOrderProduct[]>();
  for (const product of products) {
    const id = product.categoryId || UNCATEGORIZED_ID;
    const list = byCategory.get(id);
    if (list) list.push(product);
    else byCategory.set(id, [product]);
  }
  return categories
    .filter((category) => byCategory.has(category.id))
    .map((category) => ({ category, products: byCategory.get(category.id) ?? [] }));
}

/** Tampilan harga gaya daftar menu ("32.500") — tanpa "Rp" seperti referensi. */
export function formatMenuPrice(value: number) {
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(Math.round(value));
}

export function formatRupiah(value: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(Math.round(value));
}
