// Aturan murni halaman Products & Menu: filter katalog, label tabel, editor
// varian SKU merchandise, dan matriks varian (EPIC-039 / EPIC-047).
import type { SkuMatrixRow, SkuWritePayload } from "./api";
import type { PosCatalogProduct } from "./types";

export const STATION_OPTIONS = [
  { value: "kitchen", label: "Kitchen" },
  { value: "bar", label: "Bar" },
  { value: "bakery", label: "Bakery" },
  { value: "dessert", label: "Dessert" },
  { value: "merchandise", label: "Merchandise" },
  { value: "photobooth", label: "Photobooth" },
];

export const ALL_CATEGORIES = "All";

export const generateRowId = () => Math.random().toString(36).slice(2, 11);

export function productCategories(products: PosCatalogProduct[]): string[] {
  return [ALL_CATEGORIES, ...new Set(products.map((product) => product.category).filter(Boolean))];
}

export function filterProducts(products: PosCatalogProduct[], search: string, category: string) {
  const needle = search.toLowerCase();
  return products.filter((product) => {
    const haystack = `${product.name} ${product.sku || ""}`.toLowerCase();
    const matchesSearch = !needle || haystack.includes(needle);
    return matchesSearch && (category === ALL_CATEGORIES || product.category === category);
  });
}

/** Stok merchandise: jumlah stok SKU aktif bila ber-varian, selain itu stok produk. */
export function merchStockLabel(product: PosCatalogProduct): number {
  const activeSkus = product.merchSkus.filter((sku) => sku.active);
  if (activeSkus.length > 0) return activeSkus.reduce((sum, sku) => sum + sku.stock, 0);
  return product.inventoryQuantity;
}

export function inferStation(product: PosCatalogProduct): string {
  if (product.station) return product.station;
  const text = `${product.category} ${product.name}`;
  if (/drink|minuman|kopi|coffee|tea|teh|juice|soda|latte|cappuccino/i.test(text)) return "bar";
  if (/dessert|cake|kue|roti|bread|pastry|donut|bakery/i.test(text)) return "bakery";
  return "kitchen";
}

export function formatMarginLabel(margin: number): string {
  const hasFraction = Math.abs(margin % 1) > 0.001;
  return `${margin.toFixed(hasFraction ? 2 : 0)}%`;
}

export function marginTone(margin: number): string {
  if (margin < 0) return "text-red-600";
  if (margin < 15) return "text-amber-600";
  return "text-green-600";
}

/** Input "Min XP": kosong/0 = produk umum (null). */
export function parseMinXp(raw: string): number | null {
  return raw.trim() === "" ? null : Math.max(0, Math.floor(Number(raw)) || 0) || null;
}

/** Input "Bonus XP": bilangan bulat ≥ 0. */
export function parseBonusXp(raw: string): number {
  return Math.max(0, Math.floor(Number(raw)) || 0);
}

// ── Editor varian ber-SKU (EPIC-039 Fase B) ─────────────────────────────────

export type MerchSkuRow = {
  rowId: string;
  /** Terisi = SKU sudah tersimpan di server. */
  id?: string;
  sku: string;
  name: string;
  barcode: string;
  stock: string;
  price: string;
  active: boolean;
  deleted?: boolean;
};

export function skuRowsFromProduct(product: PosCatalogProduct): MerchSkuRow[] {
  return product.merchSkus.map((sku) => ({
    rowId: sku.id,
    id: sku.id,
    sku: sku.sku,
    name: sku.name,
    barcode: sku.barcode ?? "",
    stock: String(sku.stock),
    price: sku.priceOverride === null ? "" : String(sku.priceOverride),
    active: sku.active,
  }));
}

export function skuRowsFromMatrix(skus: SkuMatrixRow[]): MerchSkuRow[] {
  return skus.map((sku) => ({
    rowId: sku.id,
    id: sku.id,
    sku: sku.sku,
    name: sku.name,
    barcode: sku.barcode ?? "",
    stock: String(sku.stock_quantity),
    price: sku.price_override === null || sku.price_override === undefined ? "" : String(sku.price_override),
    active: sku.is_active,
  }));
}

export function newSkuRow(): MerchSkuRow {
  return { rowId: generateRowId(), sku: "", name: "", barcode: "", stock: "0", price: "", active: true };
}

/** Baris tersimpan ditandai `deleted` (dihapus saat simpan); baris baru langsung dibuang. */
export function removeSkuRow(rows: MerchSkuRow[], rowId: string): MerchSkuRow[] {
  return rows
    .map((row) => (row.rowId === rowId ? (row.id ? { ...row, deleted: true } : null) : row))
    .filter((row): row is MerchSkuRow => row !== null);
}

export function skuRowPayload(row: MerchSkuRow): SkuWritePayload {
  return {
    sku: row.sku.trim(),
    name: row.name.trim(),
    barcode: row.barcode.trim() || null,
    price_override: row.price.trim() === "" ? null : Number(row.price),
    stock_quantity: Number(row.stock),
    is_active: row.active,
  };
}

export type MerchFormState = {
  sourceProductId: string;
  stock: string;
  weightGram: string;
  webDistributed: boolean;
  /** Harga promo toko online; kosong = tanpa promo */
  salePrice: string;
  /** Akhir promo, "YYYY-MM-DD" untuk input date; kosong = tanpa batas */
  saleUntil: string;
  isFeatured: boolean;
  isNew: boolean;
};

export function merchFormFromProduct(product: PosCatalogProduct): MerchFormState {
  return {
    sourceProductId: product.sourceProductId ?? "",
    stock: String(product.inventoryQuantity ?? 0),
    weightGram: product.weightGram === null ? "" : String(product.weightGram),
    webDistributed: product.webDistributed,
    salePrice: product.salePriceIdr === null ? "" : String(product.salePriceIdr),
    saleUntil: product.saleUntil ? product.saleUntil.slice(0, 10) : "",
    isFeatured: product.isFeatured,
    isNew: product.isNew,
  };
}

type MerchSettingsChecked = {
  stock: number;
  weightGram: number | null;
  salePriceIdr: number | null;
  /** Akhir promo sebagai ISO akhir hari WIB, null = tanpa batas */
  saleUntil: string | null;
};

/** Validasi sebelum menyentuh server; pesan galat sama dengan yang dulu di halaman. */
export function validateMerchSettings(
  form: MerchFormState,
  rows: MerchSkuRow[],
  basePrice = Number.POSITIVE_INFINITY
): ({ ok: true } & MerchSettingsChecked) | { ok: false; error: string } {
  const stock = Number(form.stock);
  if (!Number.isFinite(stock) || stock < 0) return { ok: false, error: "Stok harus angka ≥ 0" };
  const weightGram = form.weightGram.trim() === "" ? null : Number(form.weightGram);
  if (weightGram !== null && (!Number.isFinite(weightGram) || weightGram < 0)) {
    return { ok: false, error: "Berat harus angka gram ≥ 0" };
  }
  const salePriceIdr = form.salePrice.trim() === "" ? null : Number(form.salePrice);
  if (salePriceIdr !== null && (!Number.isFinite(salePriceIdr) || salePriceIdr <= 0)) {
    return { ok: false, error: "Harga promo harus angka > 0, atau kosongkan" };
  }
  if (salePriceIdr !== null && salePriceIdr >= basePrice) {
    return { ok: false, error: "Harga promo harus lebih rendah dari harga normal" };
  }
  if (form.saleUntil.trim() !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(form.saleUntil.trim())) {
    return { ok: false, error: "Tanggal akhir promo tidak valid" };
  }
  const saleUntil = salePriceIdr !== null && form.saleUntil.trim() !== "" ? `${form.saleUntil.trim()}T23:59:59+07:00` : null;
  for (const row of rows.filter((r) => !r.deleted)) {
    if (!row.sku.trim() || !row.name.trim()) return { ok: false, error: "Setiap varian wajib punya kode SKU dan nama" };
    if (!Number.isFinite(Number(row.stock))) return { ok: false, error: `Stok varian ${row.name || row.sku} harus angka` };
  }
  return { ok: true, stock, weightGram, salePriceIdr, saleUntil };
}

// ── Matriks varian (EPIC-047 Fase 1A) ───────────────────────────────────────

export type MatrixAxisRow = {
  key: string;
  label: string;
  values: string[];
  custom: boolean;
};

export const DEFAULT_MATRIX_AXES: MatrixAxisRow[] = [
  { key: "ukuran", label: "Ukuran", values: [], custom: false },
  { key: "warna", label: "Warna", values: [], custom: false },
];

/** Tambah nilai dipisah koma ke satu sumbu, buang duplikat (tanpa beda huruf besar/kecil). */
export function addAxisValues(axes: MatrixAxisRow[], axisKey: string, raw: string): MatrixAxisRow[] {
  const parts = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (parts.length === 0) return axes;
  return axes.map((axis) => {
    if (axis.key !== axisKey) return axis;
    const seen = new Set(axis.values.map((value) => value.toLowerCase()));
    const values = [...axis.values];
    for (const part of parts) {
      if (seen.has(part.toLowerCase())) continue;
      seen.add(part.toLowerCase());
      values.push(part);
    }
    return { ...axis, values };
  });
}

/** Ketikan chip berisi koma: bagian sebelum koma terakhir jadi nilai, sisanya tetap draf. */
export function splitChipDraft(value: string): { commit: string; draft: string } {
  if (!value.includes(",")) return { commit: "", draft: value };
  const segments = value.split(",");
  const draft = segments.pop() ?? "";
  return { commit: segments.join(","), draft };
}

/** Harga override matriks: kosong = null; selain itu harus angka ≥ 0. */
export function parseMatrixPrice(raw: string): { ok: true; value: number | null } | { ok: false } {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, value: null };
  const value = Number(trimmed);
  return Number.isFinite(value) && value >= 0 ? { ok: true, value } : { ok: false };
}

export function matrixResultMessage(result: {
  created: unknown[];
  reactivated: unknown[];
  deactivated: unknown[];
  kept: unknown[];
}): string {
  const reactivated = result.reactivated.length;
  return `${result.created.length} SKU dibuat${reactivated > 0 ? `, ${reactivated} diaktifkan kembali` : ""}, ${result.deactivated.length} dinonaktifkan, ${result.kept.length} tidak berubah`;
}
