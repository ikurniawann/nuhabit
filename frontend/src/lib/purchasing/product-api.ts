// Data master produk untuk /api/purchasing/products/**: daftar (+ review HPP),
// detail + biaya BOM, simpan + sinkron POS, soft delete, terapkan HPP resep.
import { ApiError } from "@/lib/api/auth";
import {
  branchScopeOr,
  companyScopeOr,
  isRowInBusinessScope,
  validateProductWarehouseScope,
  type UserScope,
} from "@/lib/api/scope";
import { query as dbQuery } from "@/lib/db";
import { formatRupiah } from "@/lib/format";
import type { DbClient } from "@/lib/pg/types";
import { resolvePosStation } from "@/lib/pos/kitchen-station";
import { syncPurchasingProductToPos } from "@/lib/pos/purchasing-sync";
import {
  buildStockCostMap,
  costBomLines,
  fallbackMaterialCost,
  type BomMaterialPrice,
  type StockCostRow,
} from "@/lib/purchasing/bom-cost";
import { nextSequentialCode, utcDateStamp } from "@/lib/purchasing/item-codes";
import type {
  ProductCreateInput,
  ProductUpdateInput,
} from "@/lib/purchasing/product-api-schemas";
import {
  buildProductHppReview,
  withProductHppReview,
  type ProductHppReviewSource,
} from "@/lib/purchasing/product-hpp-review";

/** Kolom products / v_products_cogs yang dibaca kode ini (baris lain diteruskan apa adanya). */
interface ProductRow extends ProductHppReviewSource {
  id: string;
  company_id: string | null;
  branch_id: string | null;
  warehouse_id: string | null;
  kategori?: string | null;
  station?: string | null;
  production_output_type?: string | null;
}

interface ProductBomRow {
  raw_material_id: string | null;
  qty_required: number | string | null;
  waste_factor: number | string | null;
  raw_material: BomMaterialPrice | null;
}

export type PosSyncResult = Awaited<ReturnType<typeof syncPurchasingProductToPos>> | null;

export interface ProductListParams {
  search: string | null;
  isActive: string | null;
  warehouseId: string | null;
  hppReview: boolean;
  page: number;
  limit: number;
}

const NOT_FOUND = "Produk tidak ditemukan";

/**
 * EPIC-047 Fase 1A — badge "N varian": hitung SKU POS merchandise aktif per
 * produk (join via pos_products.source_product_id).
 */
async function attachVariantCounts<T extends { id: string }>(
  rows: T[]
): Promise<(T & { variant_count: number })[]> {
  if (rows.length === 0) return [];
  const counts = await dbQuery<{ product_id: string; variant_count: number }>(
    `SELECT p.source_product_id AS product_id, COUNT(s.id)::int AS variant_count
     FROM pos.pos_products p
     JOIN pos.pos_product_skus s ON s.product_id = p.id AND s.is_active = true
     WHERE p.source_product_id = ANY($1::uuid[])
     GROUP BY p.source_product_id`,
    [rows.map((row) => row.id)]
  );
  const countMap = new Map(counts.map((row) => [row.product_id, row.variant_count]));
  return rows.map((row) => ({ ...row, variant_count: countMap.get(row.id) ?? 0 }));
}

export async function listProducts(
  db: DbClient,
  scope: UserScope | null,
  params: ProductListParams
) {
  const { search, isActive, warehouseId, hppReview, page, limit } = params;
  let query = db.from("v_products_cogs").select("*", { count: "exact" }).is("deleted_at", null);

  const companyOr = companyScopeOr(scope);
  if (companyOr) query = query.or(companyOr);
  const branchOr = branchScopeOr(scope);
  if (branchOr) query = query.or(branchOr);
  if (warehouseId) query = query.eq("warehouse_id", warehouseId);
  if (search) query = query.or(`nama.ilike.%${search}%,kode.ilike.%${search}%`);
  if (isActive !== null) query = query.eq("is_active", isActive === "true");
  if (hppReview) query = query.gt("total_bahan_baku", 0);

  const from = (page - 1) * limit;
  const to = from + limit - 1;

  if (hppReview) {
    // Review HPP difilter di memori (selisih dihitung, bukan kolom view).
    const { data, error } = await query.order("nama", { ascending: true }).limit(1000);
    if (error) throw error;
    const reviewed = ((data ?? []) as ProductRow[])
      .map((row) => withProductHppReview(row))
      .filter((row) => row.hpp_perlu_review);
    const total = reviewed.length;
    return {
      data: await attachVariantCounts(reviewed.slice(from, to + 1)),
      pagination: { page, limit, total, total_pages: Math.max(1, Math.ceil(total / limit)) },
    };
  }

  const { data, error, count } = await query.order("nama", { ascending: true }).range(from, to);
  if (error) throw error;
  const total = count || 0;
  return {
    data: await attachVariantCounts(
      ((data ?? []) as ProductRow[]).map((row) => withProductHppReview(row))
    ),
    pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
  };
}

function assertInScope(scope: UserScope | null, row: ProductRow): void {
  if (!isRowInBusinessScope(scope, { company_id: row.company_id, branch_id: row.branch_id })) {
    throw ApiError.notFound(NOT_FOUND);
  }
}

/** Detail produk + baris BOM aktif dengan biaya (harga stok rata-rata per satuan besar). */
export async function getProductDetail(db: DbClient, scope: UserScope | null, id: string) {
  const { data: product, error: productError } = await db
    .from("v_products_cogs")
    .select("*")
    .eq("id", id)
    .single();
  if (productError?.code === "PGRST116") throw ApiError.notFound(NOT_FOUND);
  if (productError) throw productError;
  assertInScope(scope, product as ProductRow);

  const { data: bomItems, error: bomError } = await db
    .from("bom_items")
    .select(`
      *,
      raw_material:raw_materials!raw_material_id (*),
      satuan:units!satuan_id (*)
    `)
    .eq("product_id", id)
    .eq("is_active", true)
    .order("created_at", { ascending: true });
  if (bomError) throw bomError;

  const rows = (bomItems ?? []) as ProductBomRow[];
  const materialIds = Array.from(
    new Set(rows.map((row) => row.raw_material_id).filter((value): value is string => Boolean(value)))
  );
  const { data: stockCosts } =
    materialIds.length > 0
      ? await db.from("v_raw_materials_stock").select("id, avg_cost").in("id", materialIds)
      : { data: [] };
  const stockCostMap = buildStockCostMap((stockCosts ?? []) as StockCostRow[], false);

  const { lines, total } = costBomLines(rows, (row) =>
    row.raw_material_id && stockCostMap.has(row.raw_material_id)
      ? stockCostMap.get(row.raw_material_id) ?? 0
      : fallbackMaterialCost(row.raw_material, false)
  );

  return {
    ...withProductHppReview(product as ProductRow),
    bom_items: lines,
    hpp_calculated: total,
  };
}

/** Sinkron ke POS hanya untuk FINISHED_GOOD; gagal sinkron tidak menggagalkan simpan. */
async function syncFinishedGoodToPos(
  db: DbClient,
  productId: string,
  outputType: string,
  options: { station: string; costPriceOverride?: number },
  context: string
): Promise<PosSyncResult> {
  if (outputType !== "FINISHED_GOOD") return null;
  try {
    return await syncPurchasingProductToPos(db, productId, options);
  } catch (syncError) {
    console.warn(`POS sync after ${context} failed:`, syncError);
    return null;
  }
}

async function generateProductCode(
  db: DbClient,
  companyId: string | null,
  branchId: string | null,
  warehouseId: string
): Promise<string> {
  const prefix = `PRD-${utcDateStamp()}`;
  let codeQuery = db
    .from("products")
    .select("kode")
    .like("kode", `${prefix}-%`)
    .eq("warehouse_id", warehouseId)
    .is("deleted_at", null)
    .order("kode", { ascending: false })
    .limit(1);
  codeQuery = companyId ? codeQuery.eq("company_id", companyId) : codeQuery.is("company_id", null);
  codeQuery = branchId ? codeQuery.eq("branch_id", branchId) : codeQuery.is("branch_id", null);

  const { data } = await codeQuery;
  const last = Array.isArray(data) ? (data[0] as { kode?: string } | undefined)?.kode : null;
  return nextSequentialCode(prefix, last, 3);
}

async function resolveWarehouse(warehouseId: string, scope: UserScope | null) {
  const warehouseScope = await validateProductWarehouseScope(warehouseId, scope);
  if ("error" in warehouseScope) throw ApiError.badRequest(warehouseScope.error);
  return warehouseScope;
}

export async function createProduct(
  db: DbClient,
  scope: UserScope | null,
  input: ProductCreateInput
): Promise<{ data: ProductRow; posSync: PosSyncResult }> {
  const {
    company_id: companyId,
    branch_id: branchId,
    warehouse_id: warehouseId,
  } = await resolveWarehouse(input.warehouse_id, scope);

  let kode = input.kode;
  if (!kode) {
    kode = await generateProductCode(db, companyId, branchId, warehouseId);
  } else {
    let existingQuery = db
      .from("products")
      .select("id")
      .eq("kode", kode)
      .eq("warehouse_id", warehouseId)
      .is("deleted_at", null);
    existingQuery = companyId
      ? existingQuery.eq("company_id", companyId)
      : existingQuery.is("company_id", null);
    existingQuery = branchId
      ? existingQuery.eq("branch_id", branchId)
      : existingQuery.is("branch_id", null);
    const { data: existing } = await existingQuery.maybeSingle();
    if (existing) throw ApiError.badRequest("Kode produk sudah digunakan di stall ini");
  }

  const { data, error } = await db
    .from("products")
    .insert({
      nama: input.nama,
      deskripsi: input.deskripsi,
      kategori: input.kategori,
      satuan_id: input.satuan_id,
      harga_jual: input.harga_jual,
      harga_modal: input.harga_modal,
      markup_persen: input.markup_persen,
      production_output_type: input.production_output_type,
      station: resolvePosStation(input.station, input.kategori),
      kode,
      company_id: companyId,
      branch_id: branchId,
      warehouse_id: warehouseId,
      is_active: true,
    })
    .select()
    .single();
  if (error) throw error;

  const row = data as ProductRow;
  const posSync = await syncFinishedGoodToPos(
    db,
    row.id,
    row.production_output_type || "FINISHED_GOOD",
    { station: resolvePosStation(row.station, row.kategori) },
    "product create"
  );
  return { data: row, posSync };
}

async function findActiveProduct(db: DbClient, id: string): Promise<ProductRow> {
  const { data, error } = await db
    .from("products")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .single();
  if (error || !data) throw ApiError.notFound(NOT_FOUND);
  return data as ProductRow;
}

export async function updateProduct(
  db: DbClient,
  scope: UserScope | null,
  id: string,
  input: ProductUpdateInput
): Promise<{ data: ProductRow; posSync: PosSyncResult }> {
  const existing = await findActiveProduct(db, id);
  assertInScope(scope, existing);

  const updatePayload: Record<string, unknown> = {
    ...input,
    station: resolvePosStation(
      input.station ?? existing.station,
      input.kategori ?? existing.kategori
    ),
    updated_at: new Date().toISOString(),
  };

  if (input.warehouse_id && input.warehouse_id !== existing.warehouse_id) {
    const warehouseScope = await resolveWarehouse(input.warehouse_id, scope);
    updatePayload.company_id = warehouseScope.company_id;
    updatePayload.branch_id = warehouseScope.branch_id;
    updatePayload.warehouse_id = warehouseScope.warehouse_id;
  }

  const { data, error } = await db
    .from("products")
    .update(updatePayload)
    .eq("id", id)
    .is("deleted_at", null)
    .select()
    .single();
  if (error) throw error;

  const row = data as ProductRow;
  const posSync = await syncFinishedGoodToPos(
    db,
    id,
    row.production_output_type || existing.production_output_type || "FINISHED_GOOD",
    {
      station: resolvePosStation(
        row.station ?? existing.station,
        row.kategori ?? existing.kategori
      ),
    },
    "product update"
  );
  return { data: row, posSync };
}

/** Soft delete (tanpa cek scope, perilaku lama). */
export async function softDeleteProduct(db: DbClient, id: string): Promise<void> {
  const { data: authData } = await db.auth.getUser();
  await findActiveProduct(db, id);

  const now = new Date().toISOString();
  const { error } = await db
    .from("products")
    .update({
      is_active: false,
      deleted_at: now,
      deleted_by: authData.user?.id ?? null,
      updated_at: now,
    })
    .eq("id", id)
    .is("deleted_at", null);
  if (error) throw error;
}

/** Salin HPP resep (hpp_estimasi) ke harga_modal produk, lalu sinkron ke POS. */
export async function applyRecipeHpp(db: DbClient, scope: UserScope | null, id: string) {
  const { data: found, error: productError } = await db
    .from("v_products_cogs")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .single();
  if (productError || !found) throw ApiError.notFound(NOT_FOUND);
  const product = found as ProductRow;
  assertInScope(scope, product);

  const review = buildProductHppReview(product);
  if (review.hpp_resep <= 0) {
    throw ApiError.badRequest(
      "HPP seharusnya belum bisa dihitung. Lengkapi BOM dan biaya bahan dulu."
    );
  }
  if (!review.hpp_perlu_review) {
    throw ApiError.badRequest("HPP saat ini sudah sama dengan HPP seharusnya.");
  }

  const { data, error: updateError } = await db
    .from("products")
    .update({ harga_modal: review.hpp_resep, updated_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null)
    .select("*")
    .single();
  if (updateError) throw updateError;
  const updated = data as ProductRow;

  const posSync = await syncFinishedGoodToPos(
    db,
    id,
    updated.production_output_type || product.production_output_type || "FINISHED_GOOD",
    {
      station: resolvePosStation(
        updated.station ?? product.station,
        updated.kategori || product.kategori
      ),
      costPriceOverride: review.hpp_resep,
    },
    "recipe HPP apply"
  );

  const refreshedReview = buildProductHppReview({
    ...product,
    ...updated,
    harga_modal: review.hpp_resep,
    hpp_estimasi: review.hpp_estimasi,
  });
  const amount = formatRupiah(review.hpp_resep);

  return {
    data: { ...updated, ...refreshedReview },
    posSync,
    message: posSync
      ? `HPP diperbarui ke ${amount} dan tersinkron ke POS.`
      : `HPP diperbarui ke ${amount}.`,
  };
}
