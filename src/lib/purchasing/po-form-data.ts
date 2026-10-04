import { branchScopeOr, companyScopeOr, type UserScope } from "@/lib/api/scope";
import type { DbClient } from "@/lib/pg/types";
import type { PurchasingModuleType } from "@/lib/purchasing/module-scope";

/**
 * Data pilihan form PR/PO (produk, barang operasional, bahan baku + pack).
 * Dipakai oleh /api/purchasing/po/form-data dan /api/purchasing/pr/form-data.
 */

type ScopedQuery = ReturnType<ReturnType<DbClient["from"]>["select"]>;

function applyBusinessScope(query: ScopedQuery, scope: UserScope | null): ScopedQuery {
  const companyOr = companyScopeOr(scope);
  if (companyOr) query = query.or(companyOr);
  const branchOr = branchScopeOr(scope);
  if (branchOr) query = query.or(branchOr);
  return query;
}

/** Kelompokkan baris berdasarkan kunci, urutan asli dipertahankan. */
export function groupBy<T>(rows: T[], keyOf: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return groups;
}

export async function loadScopedProducts(db: DbClient, scope: UserScope | null) {
  const query = db
    .from("v_products_cogs")
    .select("id, kode, nama, satuan_id, satuan_nama, harga_modal")
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("nama");
  const { data } = await applyBusinessScope(query, scope);
  return (data ?? []) as Array<{ id: string; [column: string]: unknown }>;
}

export async function loadScopedSupplies(db: DbClient, scope: UserScope | null) {
  const query = db
    .from("supply_items")
    .select("id, kode, nama, satuan_id, stockable, harga_beli")
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("nama");
  const { data } = await applyBusinessScope(query, scope);
  return data ?? [];
}

type UnitConversionRow = { raw_material_id: string; [column: string]: unknown };

/** Bahan baku aktif + pack beli (`unit_conversions`) per bahan. */
export async function loadMaterialsWithPacks(db: DbClient) {
  const { data: materials } = await db
    .from("v_raw_materials_stock")
    .select("id, kode, nama, satuan_besar_id, satuan_besar_nama, satuan_kecil_id, konversi_factor, avg_cost")
    .eq("is_active", true)
    .order("nama");
  const materialRows = (materials ?? []) as Array<{ id: string; [column: string]: unknown }>;
  const materialIds = materialRows.map((material) => material.id);

  const { data: packs } = materialIds.length
    ? await db
        .from("raw_material_unit_conversions")
        .select("raw_material_id, satuan_id, qty_in_base_unit, is_base, is_purchase_default, is_active")
        .in("raw_material_id", materialIds)
        .eq("is_active", true)
    : { data: [] };
  const packsByMaterial = groupBy((packs ?? []) as UnitConversionRow[], (pack) => pack.raw_material_id);

  return materialRows.map((material) => ({
    ...material,
    unit_conversions: packsByMaterial.get(material.id) ?? [],
  }));
}

export async function loadActiveUnits(db: DbClient, columns: string) {
  const { data } = await db.from("units").select(columns).eq("is_active", true).order("nama");
  return data ?? [];
}

async function loadVendorsForUsage(
  db: DbClient,
  scope: UserScope | null,
  usage: "fnb" | "operasional"
) {
  const query = db
    .from("vendors")
    .select("id, code, name")
    .eq("is_active", true)
    .in("usage_scope", [usage, "keduanya"])
    .order("name");
  const { data } = await applyBusinessScope(query, scope);
  return data ?? [];
}

// EPIC-047 Fase 2 — SKU merchandise aktif dilampirkan per produk di form PO.
export type PoFormSkuRow = {
  id: string;
  product_id: string;
  sku: string;
  name: string;
  options?: Record<string, string> | null;
  stock_quantity?: number | null;
};

/** Lampirkan `pos_skus` ke produk lewat pos_products.source_product_id (kosong bila tanpa varian). */
export function attachPosSkus<P extends { id: string }>(
  products: P[],
  posProducts: Array<{ id: string; source_product_id: string }>,
  skus: PoFormSkuRow[]
) {
  const posProductIdByProductId = new Map(posProducts.map((p) => [p.source_product_id, p.id]));
  const skusByPosProduct = groupBy(skus, (sku) => sku.product_id);
  return products.map((product) => {
    const posProductId = posProductIdByProductId.get(product.id);
    return { ...product, pos_skus: posProductId ? skusByPosProduct.get(posProductId) ?? [] : [] };
  });
}

async function loadProductsWithSkus(db: DbClient, scope: UserScope | null) {
  const products = await loadScopedProducts(db, scope);
  const productIds = products.map((p) => p.id);
  const { data: posProducts } = productIds.length
    ? await db
        .from("pos_products")
        .select("id, source_product_id")
        .eq("product_kind", "merchandise")
        .in("source_product_id", productIds)
    : { data: [] };
  const typedPosProducts = (posProducts ?? []) as Array<{ id: string; source_product_id: string }>;
  const posProductIds = typedPosProducts.map((p) => p.id);

  const { data: skuRows } = posProductIds.length
    ? await db
        .from("pos_product_skus")
        .select("id, product_id, sku, name, options, stock_quantity")
        .eq("is_active", true)
        .in("product_id", posProductIds)
        .order("name")
    : { data: [] };
  return attachPosSkus(products, typedPosProducts, (skuRows ?? []) as PoFormSkuRow[]);
}

const PO_UNIT_COLUMNS = "id, nama, kode";

export async function loadPoFormData(
  db: DbClient,
  moduleType: PurchasingModuleType,
  scope: UserScope | null
) {
  if (moduleType === "product") {
    // PO produk/F&B: hanya vendor ber-peruntukan 'fnb' atau 'keduanya'.
    const [vendors, products, units] = await Promise.all([
      loadVendorsForUsage(db, scope, "fnb"),
      loadProductsWithSkus(db, scope),
      loadActiveUnits(db, PO_UNIT_COLUMNS),
    ]);
    return { vendors, products, units };
  }

  if (moduleType === "general") {
    // EPIC-026 B3 — pemasok REUSE `vendors` (peruntukan 'operasional'/'keduanya').
    const [vendors, supplies, units] = await Promise.all([
      loadVendorsForUsage(db, scope, "operasional"),
      loadScopedSupplies(db, scope),
      loadActiveUnits(db, PO_UNIT_COLUMNS),
    ]);
    return { vendors, supplies, units };
  }

  const [{ data: suppliers }, materials, units] = await Promise.all([
    db.from("suppliers").select("id, kode, nama_supplier").eq("is_active", true).order("nama_supplier"),
    loadMaterialsWithPacks(db),
    loadActiveUnits(db, PO_UNIT_COLUMNS),
  ]);
  return { suppliers: suppliers ?? [], materials, units };
}
