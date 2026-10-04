import { ApiError } from "@/lib/api/auth";
import {
  branchScopeOr,
  companyScopeOr,
  effectiveBranchId,
  effectiveCompanyId,
  getApiUserScope,
} from "@/lib/api/scope";
import { MANUFACTURING_SCHEMA } from "@/lib/manufacturing/constants";
import { requiresVariantSplit, type ActiveSku } from "@/lib/manufacturing/variant-output";
import type { DbClient } from "@/lib/pg/types";
import {
  buildStockCoverage,
  coverageModeForStatus,
  nextProductionNumber,
  planMaterialsFromBom,
  productionNumberPrefix,
  sumConversionCosts,
  sumMaterialCost,
  type BomLine,
  type CoverageMode,
  type MaterialActualOverride,
  type MaterialStockRow,
  type ProductionMaterialRow,
} from "@/lib/purchasing/production-calc";
import type {
  CreateProductProductionInput,
  CreateRawMaterialProductionInput,
} from "@/lib/purchasing/production-schemas";
import { toQty } from "@/lib/purchasing/utils";

// ── Shared loaders ──────────────────────────────────────────────────────────

async function loadStockMap(db: DbClient, materialIds: string[]) {
  const uniqueIds = Array.from(new Set(materialIds.filter(Boolean)));
  if (uniqueIds.length === 0) return new Map<string, MaterialStockRow>();

  const { data, error } = await db
    .from("v_raw_materials_stock")
    .select("id, qty_onhand, avg_cost, satuan_kecil_nama, satuan_besar_nama")
    .in("id", uniqueIds);

  if (error) throw error;
  return new Map(((data || []) as MaterialStockRow[]).map((stock) => [stock.id, stock]));
}

/** Cek stok bahan yang belum dikonsumsi (inventory_movement_id kosong). */
export async function checkMaterialStock(
  db: DbClient,
  productionOrderId: string,
  mode: CoverageMode = "planned",
  overrides?: Map<string, MaterialActualOverride>
) {
  const { data, error } = await db
    .from("production_order_materials")
    .select("id, raw_material_id, qty_planned, qty_actual, inventory_movement_id, raw_material:raw_materials!raw_material_id(kode,nama)")
    .eq("production_order_id", productionOrderId);

  if (error) throw error;
  const rows = ((data || []) as ProductionMaterialRow[]).map((material) => {
    const override = overrides?.get(material.id);
    return override ? { ...material, qty_actual: override.qty_actual } : material;
  });

  const stockMap = await loadStockMap(db, rows.map((material) => material.raw_material_id));
  const coverage = buildStockCoverage(
    rows.filter((material) => !material.inventory_movement_id),
    stockMap,
    mode
  );

  return { coverage, shortages: coverage.filter((item) => item.shortage_qty > 0) };
}

export type ActiveSkuRow = ActiveSku & { stock_quantity?: number | string | null };

export interface VariantContext {
  posProductId: string | null;
  activeSkus: ActiveSkuRow[];
}

/**
 * EPIC-047 Fase 1B: resolve link resmi produk ke POS merchandise
 * (`pos_products.source_product_id = productId AND product_kind =
 * 'merchandise'`, FK EPIC-039) dan SKU aktifnya. TIDAK memakai pencocokan
 * string `PUR-<kode>` legacy (`syncPurchasingProductToPos`).
 */
export async function resolveVariantContext(
  db: DbClient,
  productId?: string | null
): Promise<VariantContext> {
  if (!productId) return { posProductId: null, activeSkus: [] };

  const { data: posProduct, error: posProductError } = await db
    .from("pos_products")
    .select("id")
    .eq("source_product_id", productId)
    .eq("product_kind", "merchandise")
    .maybeSingle();
  if (posProductError) throw posProductError;
  if (!posProduct?.id) return { posProductId: null, activeSkus: [] };

  const { data: skus, error: skusError } = await db
    .from("pos_product_skus")
    .select("id, sku, name, options, stock_quantity")
    .eq("product_id", posProduct.id)
    .eq("is_active", true)
    .order("name", { ascending: true });
  if (skusError) throw skusError;

  return { posProductId: posProduct.id as string, activeSkus: (skus || []) as ActiveSkuRow[] };
}

// ── List ────────────────────────────────────────────────────────────────────

export interface ListProductionOrdersParams {
  status: string | null;
  search: string | null;
  productionContext: string;
  limit: number;
}

export async function listProductionOrders(db: DbClient, params: ListProductionOrdersParams) {
  let query = db
    .from("v_production_orders")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(params.limit);

  const scope = await getApiUserScope();
  const companyOr = companyScopeOr(scope);
  if (companyOr) query = query.or(companyOr);
  const branchOr = branchScopeOr(scope);
  if (branchOr) query = query.or(branchOr);

  if (params.productionContext === "product" || params.productionContext === "raw_material") {
    query = query.eq("production_context", params.productionContext);
  }
  if (params.status) query = query.eq("status", params.status);
  if (params.search) {
    const s = params.search;
    query = query.or(
      `nomor_produksi.ilike.%${s}%,product_nama.ilike.%${s}%,product_kode.ilike.%${s}%,output_raw_material_nama.ilike.%${s}%,output_raw_material_kode.ilike.%${s}%,item_nama.ilike.%${s}%`
    );
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

// ── Create ──────────────────────────────────────────────────────────────────

async function generateProductionNumber(db: DbClient) {
  const prefix = productionNumberPrefix();
  const { data, error } = await db
    .from("production_orders")
    .select("nomor_produksi")
    .ilike("nomor_produksi", `${prefix}-%`)
    .order("nomor_produksi", { ascending: false })
    .limit(1);

  if (error) throw error;
  return nextProductionNumber(prefix, (data as Array<{ nomor_produksi: string }> | null)?.[0]?.nomor_produksi);
}

async function loadAvgCostMap(db: DbClient, materialIds: string[]) {
  const { data, error } = await db
    .from("v_raw_materials_stock")
    .select("id, avg_cost")
    .in("id", materialIds);
  if (error) throw error;
  return new Map(((data || []) as MaterialStockRow[]).map((stock) => [stock.id, toQty(stock.avg_cost)]));
}

interface OwnerScopeRow {
  id: string;
  company_id?: string | null;
  branch_id?: string | null;
}

interface PlannedOrderInput {
  planned_qty: number;
  overhead_cost: number;
  labor_cost: number;
  packaging_cost: number;
  waste_cost: number;
  catatan?: string | null;
}

/** Hitung biaya rencana, insert order DRAFT + baris bahannya. */
async function insertPlannedOrder(
  db: DbClient,
  userId: string,
  owner: OwnerScopeRow,
  input: PlannedOrderInput,
  bomLines: BomLine[],
  orderFields: Record<string, unknown>
) {
  const avgCostMap = await loadAvgCostMap(
    db,
    bomLines.map((line) => line.raw_material_id).filter(Boolean)
  );
  const materials = planMaterialsFromBom(bomLines, avgCostMap, input.planned_qty);
  const plannedMaterialCost = sumMaterialCost(materials);
  const hppPerUnit = (plannedMaterialCost + sumConversionCosts(input)) / input.planned_qty;
  const nomorProduksi = await generateProductionNumber(db);
  const scope = await getApiUserScope();

  const { data: order, error: orderError } = await db
    .from("production_orders")
    .insert({
      nomor_produksi: nomorProduksi,
      ...orderFields,
      company_id: owner.company_id ?? effectiveCompanyId(scope),
      branch_id: owner.branch_id ?? effectiveBranchId(scope),
      planned_qty: input.planned_qty,
      actual_qty: 0,
      status: "DRAFT",
      planned_material_cost: plannedMaterialCost,
      overhead_cost: input.overhead_cost,
      labor_cost: input.labor_cost,
      packaging_cost: input.packaging_cost,
      waste_cost: input.waste_cost,
      hpp_per_unit: hppPerUnit,
      catatan: input.catatan || null,
      created_by: userId,
    })
    .select()
    .single();
  if (orderError) throw orderError;

  const { error: materialError } = await db
    .from("production_order_materials")
    .insert(materials.map((item) => ({ ...item, production_order_id: order.id })));
  if (materialError) throw materialError;

  return { order: { ...order, materials }, nomorProduksi };
}

export async function createProductProductionOrder(
  db: DbClient,
  userId: string,
  input: CreateProductProductionInput
) {
  const { data: product, error: productError } = await db
    .from("products")
    .select("id, kode, nama, company_id, branch_id")
    .eq("id", input.product_id)
    .eq("is_active", true)
    .single();
  if (productError || !product) throw ApiError.notFound("Produk tidak ditemukan");

  const { data: bomItems, error: bomError } = await db
    .from("bom_items", MANUFACTURING_SCHEMA)
    .select("raw_material_id, satuan_id, qty_required, waste_factor")
    .eq("product_id", input.product_id)
    .eq("is_active", true);
  if (bomError) throw bomError;
  if (!bomItems || bomItems.length === 0) {
    throw ApiError.badRequest("Produk belum memiliki BOM. Lengkapi recipe/BOM dulu sebelum produksi.");
  }

  return insertPlannedOrder(db, userId, product as OwnerScopeRow, input, bomItems as BomLine[], {
    product_id: input.product_id,
    output_type: input.output_type,
    production_context: "product",
  });
}

interface RawMaterialBomRow {
  component_raw_material_id: string;
  satuan_id: string | null;
  qty_required: number | string | null;
  waste_factor: number | string | null;
}

export async function createRawMaterialProductionOrder(
  db: DbClient,
  userId: string,
  input: CreateRawMaterialProductionInput
) {
  const { data: outputMaterial, error: materialError } = await db
    .from("raw_materials")
    .select("id, kode, nama, company_id, branch_id")
    .eq("id", input.raw_material_id)
    .eq("is_active", true)
    .is("deleted_at", null)
    .single();
  if (materialError || !outputMaterial) throw ApiError.notFound("Output raw material not found");

  const { data: bomItems, error: bomError } = await db
    .from("raw_material_bom_items", MANUFACTURING_SCHEMA)
    .select("component_raw_material_id, satuan_id, qty_required, waste_factor")
    .eq("output_raw_material_id", input.raw_material_id)
    .eq("is_active", true);
  if (bomError) throw bomError;
  if (!bomItems || bomItems.length === 0) {
    throw ApiError.badRequest(
      "This raw material does not have a bill of materials. Complete the recipe before production."
    );
  }

  const bomLines = (bomItems as RawMaterialBomRow[]).map((item) => ({
    raw_material_id: item.component_raw_material_id,
    satuan_id: item.satuan_id,
    qty_required: item.qty_required,
    waste_factor: item.waste_factor,
  }));

  return insertPlannedOrder(db, userId, outputMaterial as OwnerScopeRow, input, bomLines, {
    production_context: "raw_material",
    output_raw_material_id: input.raw_material_id,
    product_id: null,
    output_type: "FINISHED_GOOD",
  });
}

// ── Detail ──────────────────────────────────────────────────────────────────

interface DetailMaterialRow extends ProductionMaterialRow {
  satuan_id?: string | null;
  satuan?: { id?: string | null; kode?: string | null; nama?: string | null } | null;
}

interface VariantOutputRow {
  production_batch_id: string;
  pos_sku_id: string;
  qty: number | string;
  sku?: { sku?: string | null; name?: string | null; options?: Record<string, string> | null } | null;
}

interface BatchVariantOutput {
  pos_sku_id: string;
  sku: string | null;
  name: string | null;
  options: Record<string, string> | null;
  qty: number | string;
}

function groupVariantOutputsByBatch(rows: VariantOutputRow[]) {
  const byBatch = new Map<string, BatchVariantOutput[]>();
  for (const row of rows) {
    const list = byBatch.get(row.production_batch_id) || [];
    list.push({
      pos_sku_id: row.pos_sku_id,
      sku: row.sku?.sku ?? null,
      name: row.sku?.name ?? null,
      options: row.sku?.options ?? null,
      qty: row.qty,
    });
    byBatch.set(row.production_batch_id, list);
  }
  return byBatch;
}

async function loadOutputUnitName(
  db: DbClient,
  order: { product_id?: string | null; output_raw_material_id?: string | null }
) {
  if (order.product_id) {
    const { data: product } = await db
      .from("products")
      .select("satuan:units!satuan_id(nama)")
      .eq("id", order.product_id)
      .maybeSingle();
    return (product as { satuan?: { nama?: string | null } | null } | null)?.satuan?.nama || null;
  }
  if (order.output_raw_material_id) {
    const { data } = await db
      .from("v_raw_materials_stock")
      .select("satuan_besar_nama, satuan_kecil_nama")
      .eq("id", order.output_raw_material_id)
      .maybeSingle();
    const unit = data as Pick<MaterialStockRow, "satuan_besar_nama" | "satuan_kecil_nama"> | null;
    return unit?.satuan_besar_nama || unit?.satuan_kecil_nama || null;
  }
  return null;
}

export async function getProductionOrderDetail(db: DbClient, id: string) {
  const { data: order, error: orderError } = await db
    .from("v_production_orders")
    .select("*")
    .eq("id", id)
    .single();
  if (orderError || !order) throw ApiError.notFound("Production order not found");

  const [{ data: materialData, error: materialsError }, { data: batchData, error: batchesError }] =
    await Promise.all([
      db
        .from("production_order_materials")
        .select("*, raw_material:raw_materials!raw_material_id(id,kode,nama), satuan:units!satuan_id(id,kode,nama)")
        .eq("production_order_id", id)
        .order("created_at", { ascending: true }),
      db
        .from("production_batches")
        .select("*")
        .eq("production_order_id", id)
        .order("created_at", { ascending: false }),
    ]);
  if (materialsError) throw materialsError;
  if (batchesError) throw batchesError;

  const materials = (materialData || []) as DetailMaterialRow[];
  const batches = (batchData || []) as Array<{ id: string } & Record<string, unknown>>;

  const outputSatuanNama = await loadOutputUnitName(db, order);
  const stockMap = await loadStockMap(db, materials.map((material) => material.raw_material_id));
  const stockCoverage = buildStockCoverage(materials, stockMap, coverageModeForStatus(order.status));
  const coverageByMaterialId = new Map(stockCoverage.map((item) => [item.id, item]));

  // EPIC-047 Fase 1B: SKU aktif produk (kalau tertaut POS merchandise) +
  // rincian varian yang sudah diposting per batch.
  const variantContext = await resolveVariantContext(db, order.product_id);
  let variantOutputsByBatch = new Map<string, BatchVariantOutput[]>();
  if (batches.length > 0) {
    const { data: variantOutputs, error: variantOutputsError } = await db
      .from("production_output_variants")
      .select("production_batch_id, pos_sku_id, qty, sku:pos_product_skus!pos_sku_id(sku,name,options)")
      .eq("production_order_id", id);
    if (variantOutputsError) throw variantOutputsError;
    variantOutputsByBatch = groupVariantOutputsByBatch((variantOutputs || []) as VariantOutputRow[]);
  }

  return {
    ...order,
    output_satuan_nama: outputSatuanNama,
    pos_skus: variantContext.activeSkus.map((sku) => ({
      id: sku.id,
      sku: sku.sku,
      name: sku.name,
      options: sku.options ?? null,
      stock_quantity: sku.stock_quantity,
    })),
    variant_required: requiresVariantSplit(variantContext.activeSkus),
    materials: materials.map((material) => {
      const stockRow = stockMap.get(material.raw_material_id);
      const unitName =
        material.satuan?.nama || stockRow?.satuan_kecil_nama || stockRow?.satuan_besar_nama || null;
      return {
        ...material,
        satuan: material.satuan?.nama
          ? material.satuan
          : unitName
            ? { id: material.satuan_id, nama: unitName, kode: null }
            : null,
        stock: coverageByMaterialId.get(material.id) || null,
      };
    }),
    batches: batches.map((batch) => ({
      ...batch,
      variant_outputs: variantOutputsByBatch.get(batch.id) || [],
    })),
    stock_coverage: stockCoverage,
    stock_summary: {
      total_materials: stockCoverage.length,
      insufficient_materials: stockCoverage.filter((item) => item.shortage_qty > 0).length,
      can_release: stockCoverage.every((item) => item.shortage_qty <= 0),
    },
  };
}
