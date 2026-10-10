import { computeMarginPercentage } from "@/lib/pos/margin";
import type { ApiPosProduct, PatchPosProductPayload, PosCatalogProduct } from "./types";
import { normalizeSalesChannels } from "@/lib/pos/sales-channels";

export type * from "./types";

const toNumber = (value: unknown) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

function resolveProductCost(product: ApiPosProduct) {
  const bomCost = toNumber(product.hpp_estimasi ?? product.estimated_cogs);
  const storedCost = toNumber(product.cost_price);
  return bomCost > 0 ? bomCost : storedCost;
}

const generateId = () => Math.random().toString(36).slice(2, 11);

function normalizeCategory(category: ApiPosProduct["category"]) {
  if (typeof category === "string") return category || "Uncategorized";
  const row = Array.isArray(category) ? category[0] : category;
  return row?.name || "Uncategorized";
}

export function mapApiPosProduct(product: ApiPosProduct): PosCatalogProduct {
  const price = toNumber(product.base_price);
  const cost = resolveProductCost(product);
  const margin = computeMarginPercentage(price, cost);
  const variants = (product.variants ?? []).map((variant) => ({
    id: variant.id || generateId(),
    name: variant.name || "Regular",
    sku: variant.sku || "",
    priceAdj: toNumber(variant.price_adjustment),
    active: variant.is_active !== false,
  }));
  const modifierGroups = (product.modifiers ?? [])
    .map((link, index) => {
      const group = link.modifier_group;
      if (!group) return null;
      return {
        id: `${product.id}-mg-${index}`,
        name: group.name || `Modifier ${index + 1}`,
        required: toNumber(group.min_selection) > 0,
        maxSelect: Math.max(1, toNumber(group.max_selection) || 1),
        active: true,
        modifiers: (group.modifiers ?? []).map((modifier) => ({
          id: modifier.id || generateId(),
          name: modifier.name || "Modifier",
          priceAdj: toNumber(modifier.price_adjustment),
          active: modifier.is_active !== false,
        })),
      };
    })
    .filter((group): group is PosCatalogProduct["modifierGroups"][number] => Boolean(group));

  return {
    id: product.id,
    sku: product.sku || undefined,
    name: product.name || "Untitled Product",
    category: normalizeCategory(product.category),
    price,
    cost,
    margin,
    status: product.is_active === false ? "inactive" : "active",
    station: product.station || "kitchen",
    hasVariants: variants.length > 0,
    hasModifiers: modifierGroups.length > 0,
    variants,
    modifierGroups,
    minXp:
      product.min_xp === null || product.min_xp === undefined
        ? null
        : toNumber(product.min_xp) || null,
    bonusXp: Math.max(0, Math.floor(toNumber(product.bonus_xp))),
    productKind: product.product_kind || "regular",
    sourceProductId: product.source_product_id || null,
    inventoryTracking: product.inventory_tracking === true,
    inventoryQuantity: toNumber(product.inventory_quantity),
    weightGram:
      product.weight_gram === null || product.weight_gram === undefined
        ? null
        : toNumber(product.weight_gram),
    sizeGuide: product.size_guide || null,
    salePriceIdr:
      product.sale_price_idr === null || product.sale_price_idr === undefined
        ? null
        : toNumber(product.sale_price_idr),
    saleUntil: product.sale_until || null,
    isFeatured: product.is_featured === true,
    isNew: product.is_new === true,
    salesChannels: normalizeSalesChannels(product.sales_channels),
    webDistributed: (product.channels ?? []).some(
      (channel) => channel.channel_code === "web" && channel.is_distributed !== false
    ),
    merchSkus: (product.skus ?? []).map((sku) => ({
      id: sku.id,
      sku: sku.sku || "",
      name: sku.name || "",
      barcode: sku.barcode || null,
      priceOverride:
        sku.price_override === null || sku.price_override === undefined
          ? null
          : toNumber(sku.price_override),
      stock: toNumber(sku.stock_quantity),
      active: sku.is_active !== false,
    })),
  };
}

async function parsePosResponse<T>(response: Response, fallbackError: string): Promise<T> {
  const json = await response.json();
  if (!response.ok || !json.success) {
    throw new Error(json.error || fallbackError);
  }
  return json as T;
}

export async function listPosCatalogProducts(): Promise<PosCatalogProduct[]> {
  const response = await fetch("/api/pos/products?include_inactive=true", { cache: "no-store" });
  const json = await parsePosResponse<{ data: ApiPosProduct[] }>(response, "Gagal memuat produk");
  return (json.data ?? []).map(mapApiPosProduct);
}

// EPIC-039 Fase B — CRUD varian SKU merchandise
export type SkuWritePayload = {
  sku?: string;
  name?: string;
  barcode?: string | null;
  price_override?: number | null;
  stock_quantity?: number;
  is_active?: boolean;
};

export async function createProductSku(productId: string, payload: SkuWritePayload) {
  const response = await fetch(`/api/pos/products/${productId}/skus`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  await parsePosResponse(response, "Gagal membuat varian");
}

export async function patchProductSku(
  productId: string,
  skuId: string,
  payload: SkuWritePayload
) {
  const response = await fetch(`/api/pos/products/${productId}/skus/${skuId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  await parsePosResponse(response, "Gagal menyimpan varian");
}

export async function deleteProductSku(productId: string, skuId: string) {
  const response = await fetch(`/api/pos/products/${productId}/skus/${skuId}`, {
    method: "DELETE",
  });
  await parsePosResponse(response, "Gagal menghapus varian");
}

// EPIC-047 Fase 1A — matriks varian (ukuran x warna x ...) -> auto-generate SKU
export type MatrixAxisPayload = {
  key: string;
  values: string[];
};

export type SkuMatrixRow = {
  id: string;
  sku: string;
  name: string;
  options: Record<string, string> | null;
  barcode: string | null;
  price_override: number | string | null;
  stock_quantity: number | string;
  is_active: boolean;
};

export type CreateSkuMatrixPayload = {
  axes: MatrixAxisPayload[];
  price_override?: number | null;
  barcode_prefix?: string;
};

// F5 fix — baris yang dihidupkan lagi (is_active=false -> true). RETURNING
// server dibatasi ke 4 kolom ini (sku/name/options/barcode/stok lama TIDAK
// ditimpa, jadi tidak perlu dikirim balik lagi di sini).
export type ReactivatedSkuMatrixRow = Pick<SkuMatrixRow, "id" | "sku" | "name" | "options">;

export type CreateSkuMatrixResult = {
  created: SkuMatrixRow[];
  reactivated: ReactivatedSkuMatrixRow[];
  deactivated: SkuMatrixRow[];
  kept: SkuMatrixRow[];
  skus: SkuMatrixRow[];
};

export type BlockedSkuMatrixRow = {
  id: string;
  sku: string;
  name: string;
  stock_quantity: number | string;
};

/** 409: SKU ber-stok tidak bisa dinonaktifkan otomatis — bawa daftar SKU yang diblokir. */
export class SkuMatrixConflictError extends Error {
  blocked: BlockedSkuMatrixRow[];
  constructor(message: string, blocked: BlockedSkuMatrixRow[]) {
    super(message);
    this.name = "SkuMatrixConflictError";
    this.blocked = blocked;
  }
}

export async function createSkuMatrix(
  productId: string,
  payload: CreateSkuMatrixPayload
): Promise<CreateSkuMatrixResult> {
  const response = await fetch(`/api/pos/products/${productId}/skus/matrix`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await response.json();
  if (!response.ok || !json.success) {
    if (response.status === 409 && Array.isArray(json.blocked)) {
      throw new SkuMatrixConflictError(
        json.error || "SKU ber-stok tidak bisa dinonaktifkan otomatis",
        json.blocked
      );
    }
    throw new Error(json.error || "Gagal membuat matriks varian");
  }
  return json.data as CreateSkuMatrixResult;
}

export async function patchPosProduct(
  id: string,
  payload: PatchPosProductPayload
): Promise<PosCatalogProduct | null> {
  const response = await fetch(`/api/pos/products/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await parsePosResponse<{ data?: ApiPosProduct }>(response, "Gagal menyimpan produk");
  return json.data ? mapApiPosProduct(json.data) : null;
}

/** EPIC-039 Fase A — pilihan tautan master purchasing (item barang jadi). */
export type PurchasingProductOption = { id: string; kode?: string | null; nama?: string | null };

export async function listPurchasingProductOptions(): Promise<PurchasingProductOption[]> {
  const response = await fetch("/api/purchasing/products?is_active=true&limit=200", { cache: "no-store" });
  const json = (await response.json()) as { data?: unknown };
  const rows = Array.isArray(json?.data) ? (json.data as PurchasingProductOption[]) : [];
  return rows.map((row) => ({ id: row.id, kode: row.kode, nama: row.nama }));
}

/** Sinkronkan varian SKU: hapus dulu, lalu ubah/buat (urutan aman untuk kode unik). */
export async function syncMerchSkus(
  productId: string,
  rows: Array<{ id?: string; deleted?: boolean; payload: SkuWritePayload }>
) {
  for (const row of rows) {
    if (row.deleted && row.id) await deleteProductSku(productId, row.id);
  }
  for (const row of rows) {
    if (row.deleted) continue;
    if (row.id) await patchProductSku(productId, row.id, row.payload);
    else await createProductSku(productId, row.payload);
  }
}
