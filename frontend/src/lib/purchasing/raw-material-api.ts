// Data master bahan baku untuk /api/purchasing/raw-materials/**.
import { ApiError } from "@/lib/api/auth";
import {
  branchScopeOr,
  companyScopeOr,
  effectiveBranchId,
  effectiveCompanyId,
  isRowInBusinessScope,
  type UserScope,
} from "@/lib/api/scope";
import type { rawMaterialStockSource } from "@/lib/api/stall-scope";
import type { DbClient } from "@/lib/pg/types";
import { nextSequentialCode } from "@/lib/purchasing/item-codes";
import { getPurchasePriceSuggestions } from "@/lib/purchasing/purchase-price";
import {
  conversionUpdateRow,
  packDefaultFlagsToReset,
  planUnitConversions,
  resolveCreateCoa,
  resolveUpdateCoa,
  summarizePurchaseCosts,
  summarizeStockStatus,
  type RawMaterialCreateInput,
  type RawMaterialUpdateInput,
} from "@/lib/purchasing/raw-material-api-rules";

type StockSource = Awaited<ReturnType<typeof rawMaterialStockSource>>;
type CoaEnum = "PRODUCTION" | "RND" | "ASSET";

/** Kolom raw_materials yang dibaca kode ini (baris lain diteruskan apa adanya). */
interface RawMaterialRow {
  id: string;
  company_id: string | null;
  branch_id: string | null;
  satuan_besar_id: string | null;
  satuan_kecil_id: string | null;
  konversi_factor: number | string | null;
  coa?: CoaEnum | null;
  coa_production?: string | null;
  coa_rnd?: string | null;
  coa_asset?: string | null;
}

interface ConversionRow {
  raw_material_id: string;
}

export interface RawMaterialListParams {
  search: string | null;
  kategori: string | null;
  satuanBesarId: string | null;
  isActive: string | null;
  belowMinimum: boolean;
  page: number;
  limit: number;
  sortBy: string;
  ascending: boolean;
}

const NOT_FOUND = "Bahan baku tidak ditemukan";

const UNIT_CONVERSION_SELECT = `
  *,
  satuan:units!satuan_id (*)
`;

type Filterable = {
  or: (filter: string) => Filterable;
  eq: (column: string, value: string | boolean) => Filterable;
};

/** Daftar + kartu ringkasan (ringkasan mengabaikan below_minimum agar tetap KPI global). */
export async function listRawMaterials(
  db: DbClient,
  scope: UserScope | null,
  { view, warehouseId }: StockSource,
  params: RawMaterialListParams
) {
  const companyOr = companyScopeOr(scope);
  const branchOr = branchScopeOr(scope);

  const applyFilters = <T extends Filterable>(q: T, includeBelowMinimum: boolean): T => {
    let next: Filterable = q;
    if (warehouseId) next = next.eq("warehouse_id", warehouseId);
    if (companyOr) next = next.or(companyOr);
    if (branchOr) next = next.or(branchOr);
    if (params.search) {
      next = next.or(`nama.ilike.%${params.search}%,kode.ilike.%${params.search}%`);
    }
    if (params.kategori) next = next.eq("kategori", params.kategori);
    if (params.satuanBesarId) next = next.eq("satuan_besar_id", params.satuanBesarId);
    if (params.isActive !== null) next = next.eq("is_active", params.isActive === "true");
    if (includeBelowMinimum && params.belowMinimum) {
      next = next.or("status_stok.eq.MENIPIS,status_stok.eq.HABIS");
    }
    return next as T;
  };

  const listQuery = applyFilters(
    db.from(view).select("*", { count: "exact" }).is("deleted_at", null),
    true
  );
  const summaryQuery = applyFilters(
    db.from(view).select("status_stok").is("deleted_at", null),
    false
  );

  const { data: statusRows, error: summaryError } = await summaryQuery;
  if (summaryError) throw summaryError;

  const from = (params.page - 1) * params.limit;
  const { data, error, count } = await listQuery
    .order(params.sortBy, { ascending: params.ascending })
    .range(from, from + params.limit - 1);
  if (error) throw error;

  const materials = (data ?? []) as Array<{ id: string }>;
  const materialIds = materials.map((material) => material.id).filter(Boolean);
  let rows: Array<{ id: string; unit_conversions?: ConversionRow[] }> = materials;

  if (materialIds.length > 0) {
    const { data: conversions, error: conversionsError } = await db
      .from("raw_material_unit_conversions")
      .select(UNIT_CONVERSION_SELECT)
      .in("raw_material_id", materialIds)
      .eq("is_active", true)
      .order("is_base", { ascending: false })
      .order("qty_in_base_unit", { ascending: true });
    if (conversionsError) throw conversionsError;

    const byMaterial = new Map<string, ConversionRow[]>();
    for (const conversion of (conversions ?? []) as ConversionRow[]) {
      const list = byMaterial.get(conversion.raw_material_id) ?? [];
      list.push(conversion);
      byMaterial.set(conversion.raw_material_id, list);
    }
    rows = materials.map((material) => ({
      ...material,
      unit_conversions: byMaterial.get(material.id) ?? [],
    }));
  }

  const total = count || 0;
  return {
    data: rows,
    pagination: {
      page: params.page,
      limit: params.limit,
      total,
      total_pages: Math.ceil(total / params.limit),
    },
    summary: summarizeStockStatus((statusRows ?? []) as Array<{ status_stok?: string | null }>),
  };
}

async function listActiveConversions(db: DbClient, rawMaterialId: string) {
  const { data, error } = await db
    .from("raw_material_unit_conversions")
    .select(UNIT_CONVERSION_SELECT)
    .eq("raw_material_id", rawMaterialId)
    .eq("is_active", true)
    .order("is_base", { ascending: false })
    .order("qty_in_base_unit", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** Detail + 10 pergerakan stok terakhir + produk pemakai (BOM) + konversi aktif. */
export async function getRawMaterialDetail(
  db: DbClient,
  scope: UserScope | null,
  { view, warehouseId }: StockSource,
  id: string
) {
  let detailQuery = db.from(view).select("*").eq("id", id);
  if (warehouseId) detailQuery = detailQuery.eq("warehouse_id", warehouseId);
  const { data, error } = await detailQuery.single();
  if (error?.code === "PGRST116") throw ApiError.notFound(NOT_FOUND);
  if (error) throw error;
  const material = data as RawMaterialRow;
  if (!isRowInBusinessScope(scope, material)) throw ApiError.notFound(NOT_FOUND);

  const { data: movements, error: movementsError } = await db
    .from("inventory_movements")
    .select("*")
    .eq("raw_material_id", id)
    .order("created_at", { ascending: false })
    .limit(10);
  if (movementsError) throw movementsError;

  const { data: products, error: productsError } = await db
    .from("bom_items")
    .select(`
      *,
      product:products!product_id (*)
    `)
    .eq("raw_material_id", id)
    .eq("is_active", true);
  if (productsError) throw productsError;

  return {
    ...material,
    movements: movements ?? [],
    products: products ?? [],
    unit_conversions: await listActiveConversions(db, id),
  };
}

/** Kode otomatis BHN-<tahun>-NNNN (urutan global, bukan per scope). */
async function generateMaterialCode(db: DbClient): Promise<string> {
  const prefix = `BHN-${new Date().getFullYear()}`;
  const { data } = await db
    .from("raw_materials")
    .select("kode")
    .ilike("kode", `${prefix}-%`)
    .is("deleted_at", null)
    .order("kode", { ascending: false })
    .limit(1)
    .maybeSingle();
  return nextSequentialCode(prefix, (data as { kode?: string } | null)?.kode, 4);
}

export async function createRawMaterial(
  db: DbClient,
  scope: UserScope | null,
  input: RawMaterialCreateInput
) {
  const companyId = effectiveCompanyId(scope);
  const branchId = effectiveBranchId(scope);
  const kode = input.kode || (await generateMaterialCode(db));

  // Kode unik dalam scope (company + branch).
  let existingQuery = db.from("raw_materials").select("id").eq("kode", kode).is("deleted_at", null);
  existingQuery = companyId
    ? existingQuery.eq("company_id", companyId)
    : existingQuery.is("company_id", null);
  existingQuery = branchId
    ? existingQuery.eq("branch_id", branchId)
    : existingQuery.is("branch_id", null);
  const { data: existing } = await existingQuery.maybeSingle();
  if (existing) throw ApiError.badRequest("Material code is already in use");

  const { unit_conversions: packs, ...materialPayload } = input;
  const { data, error } = await db
    .from("raw_materials")
    .insert({
      ...materialPayload,
      kode,
      ...resolveCreateCoa(input),
      company_id: companyId,
      branch_id: branchId,
      is_active: true,
    })
    .select()
    .single();
  if (error) throw error;
  const material = data as RawMaterialRow;

  const { error: conversionError } = await db.from("raw_material_unit_conversions").upsert(
    planUnitConversions(material, packs).map((conversion) => ({
      raw_material_id: material.id,
      satuan_id: conversion.satuan_id,
      qty_in_base_unit: conversion.qty_in_base_unit,
      is_base: conversion.is_base,
      is_active: true,
    })),
    { onConflict: "raw_material_id,satuan_id" }
  );
  if (conversionError) throw conversionError;

  return material;
}

async function findActiveMaterial(db: DbClient, id: string): Promise<RawMaterialRow> {
  const { data, error } = await db
    .from("raw_materials")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .single();
  if (error || !data) throw ApiError.notFound(NOT_FOUND);
  return data as RawMaterialRow;
}

/**
 * Update master + (bila dikirim) set konversi aktif: pack yang hilang dari
 * payload dinonaktifkan, sisanya di-upsert. Tanpa cek scope (perilaku lama).
 */
export async function updateRawMaterial(
  db: DbClient,
  id: string,
  input: RawMaterialUpdateInput
) {
  const existing = await findActiveMaterial(db, id);
  const { unit_conversions: packs, ...materialPayload } = input;
  const flagsToReset = packs ? packDefaultFlagsToReset(packs) : [];

  const { data, error } = await db
    .from("raw_materials")
    .update({
      ...materialPayload,
      coa: resolveUpdateCoa(input, existing),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .is("deleted_at", null)
    .select()
    .single();
  if (error) throw error;
  const material = data as RawMaterialRow;
  if (!packs) return material;

  const planned = planUnitConversions(material, packs);

  // Indeks unik parsial: kosongkan flag lama sebelum flag baru ditulis.
  for (const key of flagsToReset) {
    const { error: resetError } = await db
      .from("raw_material_unit_conversions")
      .update({ [key]: false })
      .eq("raw_material_id", id);
    if (resetError) throw resetError;
  }

  const { data: currentConversions, error: currentError } = await db
    .from("raw_material_unit_conversions")
    .select("id,satuan_id")
    .eq("raw_material_id", id);
  if (currentError) throw currentError;

  const nextUnitIds = new Set(planned.map((conversion) => conversion.satuan_id));
  const inactiveIds = ((currentConversions ?? []) as Array<{ id: string; satuan_id: string }>)
    .filter((conversion) => !nextUnitIds.has(conversion.satuan_id))
    .map((conversion) => conversion.id);
  if (inactiveIds.length > 0) {
    const { error: inactiveError } = await db
      .from("raw_material_unit_conversions")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .in("id", inactiveIds);
    if (inactiveError) throw inactiveError;
  }

  if (planned.length > 0) {
    const now = new Date().toISOString();
    const { error: conversionError } = await db
      .from("raw_material_unit_conversions")
      .upsert(
        planned.map((conversion) => conversionUpdateRow(id, conversion, now)),
        { onConflict: "raw_material_id,satuan_id" }
      );
    if (conversionError) throw conversionError;
  }

  return material;
}

/** Soft delete; ditolak bila masih ada stok atau dipakai di BOM produk. */
export async function deleteRawMaterial(db: DbClient, id: string): Promise<void> {
  const { data: authData } = await db.auth.getUser();
  const material = await findActiveMaterial(db, id);

  const { data: inventory } = await db
    .from("inventory")
    .select("qty_onhand")
    .eq("raw_material_id", id)
    .single();
  const onHand = (inventory as { qty_onhand?: number } | null)?.qty_onhand;
  if (onHand && onHand > 0) {
    throw ApiError.badRequest(
      `Bahan baku tidak bisa dihapus karena masih ada stok ${onHand} ${material.satuan_besar_id || "unit"}`
    );
  }

  const { data: bomItems } = await db
    .from("bom_items")
    .select("id")
    .eq("raw_material_id", id)
    .eq("is_active", true)
    .limit(1);
  if (Array.isArray(bomItems) && bomItems.length > 0) {
    throw ApiError.badRequest(
      "Bahan baku tidak bisa dihapus karena masih digunakan di BOM produk"
    );
  }

  const now = new Date().toISOString();
  const { error } = await db
    .from("raw_materials")
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

async function findMaterialInScope(
  db: DbClient,
  scope: UserScope | null,
  id: string,
  columns: string
): Promise<Record<string, unknown> & { company_id: string | null; branch_id: string | null }> {
  const { data, error } = await db
    .from("raw_materials")
    .select(columns)
    .eq("id", id)
    .is("deleted_at", null)
    .single();
  if (error || !data) throw ApiError.notFound(NOT_FOUND);
  if (!isRowInBusinessScope(scope, data)) throw ApiError.notFound(NOT_FOUND);
  return data;
}

/** Saran harga beli terakhir (per pemasok/satuan) untuk satu bahan. */
export async function getRawMaterialPurchasePrice(
  db: DbClient,
  scope: UserScope | null,
  id: string,
  options: { supplierId: string | null; satuanId: string | null; months: number }
) {
  await findMaterialInScope(db, scope, id, "id, company_id, branch_id");
  const [suggestion] = await getPurchasePriceSuggestions(
    db,
    [{ raw_material_id: id, satuan_id: options.satuanId }],
    { supplierId: options.supplierId, months: options.months }
  );
  return suggestion ?? null;
}

const PURCHASE_REFERENCE_TYPES = ["grn", "import"];

interface PurchaseCostRow {
  unit_cost: number | string | null;
}

/** Riwayat biaya masuk (GRN/import) `months` bulan terakhir + ringkasan. */
export async function getRawMaterialPriceHistory(
  db: DbClient,
  scope: UserScope | null,
  id: string,
  { months, limit }: { months: number; limit: number }
) {
  const material = await findMaterialInScope(
    db,
    scope,
    id,
    "id, kode, nama, company_id, branch_id, satuan_besar_id, satuan_kecil_id, konversi_factor, harga_beli"
  );

  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - months);

  const { data, error } = await db
    .from("inventory_movements")
    .select(
      "id, tipe, jumlah, unit_cost, total_cost, reference_type, reference_id, reference_number, created_at"
    )
    .eq("raw_material_id", id)
    .eq("tipe", "in")
    .in("reference_type", PURCHASE_REFERENCE_TYPES)
    .gte("created_at", startDate.toISOString())
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  const costs = ((data ?? []) as PurchaseCostRow[]).filter(
    (movement) => Number(movement.unit_cost || 0) > 0
  );

  return {
    material: {
      id: material.id,
      kode: material.kode,
      nama: material.nama,
      harga_beli: Number(material.harga_beli || 0),
      konversi_factor: Number(material.konversi_factor || 1),
      satuan_besar_id: material.satuan_besar_id,
      satuan_kecil_id: material.satuan_kecil_id,
    },
    purchase_costs: costs,
    summary: summarizePurchaseCosts(
      costs.map((movement) => Number(movement.unit_cost || 0)),
      months
    ),
  };
}
