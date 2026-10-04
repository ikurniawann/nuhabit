import { ApiError } from "@/lib/api/auth";
import { isRowInBusinessScope, type UserScope } from "@/lib/api/scope";
import { MANUFACTURING_SCHEMA } from "@/lib/manufacturing/constants";
import type { DbClient } from "@/lib/pg/types";
import { toQty } from "@/lib/purchasing/utils";

type Numeric = number | string | null | undefined;

export interface CogsStockRow {
  id: string;
  qty_onhand?: Numeric;
  qty_on_order?: Numeric;
  avg_cost?: Numeric;
  material_type?: string | null;
  source_product_id?: string | null;
  konversi_factor?: Numeric;
  satuan_kecil_id?: string | null;
  satuan_besar_id?: string | null;
  satuan_kecil_nama?: string | null;
  satuan_besar_nama?: string | null;
}

/** Satu baris BOM yang sudah dinormalkan dari bom_items / raw_material_bom_items. */
export interface CogsBomLine {
  material_id: string;
  satuan_id?: string | null;
  qty_required: Numeric;
  waste_factor: Numeric;
  material?: {
    kode?: string | null;
    nama?: string | null;
    material_type?: string | null;
    source_product_id?: string | null;
  } | null;
  satuan?: { nama?: string | null } | null;
}

const round2 = (value: number) => Math.round(value * 100) / 100;
const round3 = (value: number) => Math.round(value * 1000) / 1000;

/** Unit cost menyesuaikan satuan baris BOM (besar vs kecil). */
export function unitCostForBomLine(avgCost: number, bomSatuanId: string | null | undefined, stock?: CogsStockRow | null) {
  if (!stock) return avgCost;
  if (bomSatuanId && stock.satuan_besar_id && bomSatuanId === stock.satuan_besar_id) return avgCost;
  const factor = toQty(stock.konversi_factor);
  if (stock.satuan_kecil_id && factor > 0) return avgCost / factor;
  return avgCost;
}

/** settings.overhead_rate dalam persen; default 10%. */
export function overheadRateFromSetting(value: Numeric) {
  return value ? toQty(value) / 100 : 0.1;
}

export function marginLabel(marginPct: number | null) {
  if (marginPct === null) return null;
  if (marginPct > 30) return "Healthy";
  if (marginPct > 15) return "Acceptable";
  return "Thin";
}

export interface EstimateOptions {
  /** Produk: unit cost dikonversi ke satuan baris BOM dan source_product_id ikut dikirim. */
  convertUnits: boolean;
}

/** HPP estimasi = sum(qty x (1 + waste) x unit cost) + overhead. */
export function estimateBomCost(
  lines: CogsBomLine[],
  stockByMaterialId: Map<string, CogsStockRow>,
  overheadRate: number,
  { convertUnits }: EstimateOptions
) {
  let totalBomCost = 0;
  const breakdown = lines.map((line) => {
    const stock = stockByMaterialId.get(line.material_id);
    const qtyRequired = toQty(line.qty_required);
    const wasteFactor = toQty(line.waste_factor);
    const effectiveQty = qtyRequired * (1 + wasteFactor);
    const avgCost = toQty(stock?.avg_cost);
    const unitCost = convertUnits ? unitCostForBomLine(avgCost, line.satuan_id, stock) : avgCost;
    const subtotal = effectiveQty * unitCost;
    totalBomCost += subtotal;

    return {
      bahan_id: line.material_id,
      kode: line.material?.kode || "",
      nama: line.material?.nama || "",
      material_type: line.material?.material_type || stock?.material_type || "PURCHASED",
      ...(convertUnits
        ? { source_product_id: line.material?.source_product_id || stock?.source_product_id || null }
        : {}),
      jumlah: qtyRequired,
      satuan: line.satuan?.nama || stock?.satuan_kecil_nama || stock?.satuan_besar_nama || "-",
      qty_available: toQty(stock?.qty_onhand),
      qty_on_order: toQty(stock?.qty_on_order),
      unit_cost: unitCost,
      waste_percentage: wasteFactor * 100,
      effective_qty: round3(effectiveQty),
      subtotal: round2(subtotal),
    };
  });

  const totalOverhead = totalBomCost * overheadRate;
  return {
    breakdown,
    hpp_per_unit: round2(totalBomCost + totalOverhead),
    total_bom_cost: round2(totalBomCost),
    overhead_rate: overheadRate * 100,
    total_overhead: round2(totalOverhead),
  };
}

/** Bahan yang stoknya cukup untuk kurang dari 10 unit produk. */
export function buildStockWarnings(breakdown: Array<{ nama: string; jumlah: number; qty_available: number }>) {
  return breakdown
    .filter((item) => item.jumlah > 0 && item.qty_available < item.jumlah * 10)
    .map((item) => ({
      nama: item.nama,
      qty_available: item.qty_available,
      required_per_unit: item.jumlah,
      stock_coverage_units: Math.round((item.qty_available / item.jumlah) * 10) / 10,
    }));
}

export function marginVsSellingPrice(hargaJual: number, hppPerUnit: number) {
  const margin = hargaJual > 0 ? hargaJual - hppPerUnit : null;
  const marginPct = margin !== null ? Math.round((margin / hargaJual) * 10000) / 100 : null;
  return { margin, marginPct };
}

// ── Loaders ─────────────────────────────────────────────────────────────────

async function loadStockRows(db: DbClient, materialIds: string[], columns: string) {
  if (materialIds.length === 0) return new Map<string, CogsStockRow>();
  const { data, error } = await db.from("v_raw_materials_stock").select(columns).in("id", materialIds);
  if (error) throw error;
  return new Map(((data || []) as CogsStockRow[]).map((stock) => [stock.id, stock]));
}

async function loadOverheadRate(db: DbClient) {
  const { data } = await db.from("settings").select("value").eq("key", "overhead_rate").maybeSingle();
  return overheadRateFromSetting(data?.value);
}

const uniqueIds = (lines: CogsBomLine[]) =>
  Array.from(new Set(lines.map((line) => line.material_id).filter(Boolean)));

interface ProductCogsRow {
  id: string;
  kode?: string | null;
  nama?: string | null;
  satuan_nama?: string | null;
  harga_jual?: Numeric;
  company_id?: string | null;
  branch_id?: string | null;
}

interface ProductBomRow {
  raw_material_id: string;
  satuan_id?: string | null;
  qty_required: Numeric;
  waste_factor: Numeric;
  raw_material?: CogsBomLine["material"];
  satuan?: CogsBomLine["satuan"];
}

/** COGS estimasi real-time produk dari BOM + stok bahan. */
export async function getProductCogs(db: DbClient, productId: string, scope: UserScope | null) {
  const { data, error: productError } = await db
    .from("v_products_cogs")
    .select("*")
    .eq("id", productId)
    .eq("is_active", true)
    .single();
  const product = data as ProductCogsRow | null;
  if (productError || !product) throw ApiError.notFound("Product not found");
  if (!isRowInBusinessScope(scope, { company_id: product.company_id, branch_id: product.branch_id })) {
    throw ApiError.notFound("Product not found");
  }

  const { data: bomData, error: bomError } = await db
    .from("bom_items", MANUFACTURING_SCHEMA)
    .select(`
      *,
      raw_material:raw_materials!raw_material_id(id, kode, nama, material_type, source_product_id),
      satuan:units!satuan_id(id, kode, nama)
    `)
    .eq("product_id", productId)
    .eq("is_active", true)
    .order("created_at", { ascending: true });
  if (bomError) throw bomError;

  const header = {
    produk_id: product.id,
    kode: product.kode,
    nama: product.nama,
    satuan: product.satuan_nama,
    harga_jual: product.harga_jual,
  };
  const lines: CogsBomLine[] = ((bomData || []) as ProductBomRow[]).map((bom) => ({
    material_id: bom.raw_material_id,
    satuan_id: bom.satuan_id,
    qty_required: bom.qty_required,
    waste_factor: bom.waste_factor,
    material: bom.raw_material,
    satuan: bom.satuan,
  }));
  if (lines.length === 0) {
    return {
      ...header,
      hpp_per_unit: 0,
      total_bom_cost: 0,
      total_overhead: 0,
      breakdown_bahan: [],
      stock_warnings: [],
      warning: "This product does not have a bill of materials yet",
    };
  }

  const stockByMaterialId = await loadStockRows(
    db,
    uniqueIds(lines),
    "id, qty_onhand, qty_on_order, avg_cost, material_type, source_product_id, konversi_factor, satuan_kecil_id, satuan_besar_id, satuan_kecil_nama, satuan_besar_nama"
  );
  const estimate = estimateBomCost(lines, stockByMaterialId, await loadOverheadRate(db), { convertUnits: true });
  const { margin, marginPct } = marginVsSellingPrice(toQty(product.harga_jual), estimate.hpp_per_unit);

  return {
    ...header,
    hpp_per_unit: estimate.hpp_per_unit,
    total_bom_cost: estimate.total_bom_cost,
    overhead_rate: estimate.overhead_rate,
    total_overhead: estimate.total_overhead,
    breakdown_bahan: estimate.breakdown,
    margin_vs_harga_jual: margin,
    margin_percentage: marginPct,
    margin_label: marginLabel(marginPct),
    stock_warnings: buildStockWarnings(estimate.breakdown),
  };
}

interface RawMaterialBomRow {
  component_raw_material_id: string;
  satuan_id?: string | null;
  qty_required: Numeric;
  waste_factor: Numeric;
  component?: CogsBomLine["material"];
  satuan?: CogsBomLine["satuan"];
}

/** COGS estimasi bahan olahan dari BOM komponennya. */
export async function getRawMaterialCogs(db: DbClient, materialId: string) {
  const { data, error: materialError } = await db
    .from("v_raw_materials_stock")
    .select("*")
    .eq("id", materialId)
    .is("deleted_at", null)
    .single();
  const material = data as { id: string; kode?: string | null; nama?: string | null } | null;
  if (materialError || !material) throw ApiError.notFound("Raw material not found");

  const { data: bomData, error: bomError } = await db
    .from("raw_material_bom_items", MANUFACTURING_SCHEMA)
    .select(`
      *,
      component:raw_materials!component_raw_material_id(id, kode, nama, material_type),
      satuan:units!satuan_id(id, kode, nama)
    `)
    .eq("output_raw_material_id", materialId)
    .eq("is_active", true)
    .order("created_at", { ascending: true });
  if (bomError) throw bomError;

  const header = { raw_material_id: material.id, kode: material.kode, nama: material.nama };
  const lines: CogsBomLine[] = ((bomData || []) as RawMaterialBomRow[]).map((bom) => ({
    material_id: bom.component_raw_material_id,
    satuan_id: bom.satuan_id,
    qty_required: bom.qty_required,
    waste_factor: bom.waste_factor,
    material: bom.component,
    satuan: bom.satuan,
  }));
  if (lines.length === 0) {
    return {
      ...header,
      hpp_per_unit: 0,
      total_bom_cost: 0,
      total_overhead: 0,
      breakdown_bahan: [],
      warning: "This raw material does not have a bill of materials yet",
    };
  }

  const stockByMaterialId = await loadStockRows(
    db,
    uniqueIds(lines),
    "id, qty_onhand, qty_on_order, avg_cost, material_type, satuan_kecil_nama, satuan_besar_nama"
  );
  const estimate = estimateBomCost(lines, stockByMaterialId, await loadOverheadRate(db), { convertUnits: false });

  return {
    ...header,
    hpp_per_unit: estimate.hpp_per_unit,
    total_bom_cost: estimate.total_bom_cost,
    overhead_rate: estimate.overhead_rate,
    total_overhead: estimate.total_overhead,
    breakdown_bahan: estimate.breakdown,
  };
}
