// Data BOM untuk API purchasing: resep produk (manufacturing.bom_items) dan
// komponen bahan baku (manufacturing.raw_material_bom_items).
import { ApiError } from "@/lib/api/auth";
import { MANUFACTURING_SCHEMA } from "@/lib/manufacturing/constants";
import type { DbClient } from "@/lib/pg/types";
import {
  buildStockCostMap,
  costBomLines,
  fallbackMaterialCost,
  type BomMaterialPrice,
  type StockCostRow,
} from "@/lib/purchasing/bom-cost";
import type {
  ProductBomCreateInput,
  RawMaterialBomCreateInput,
} from "@/lib/purchasing/bom-schemas";

type UnitRow = { id: string } & Record<string, unknown>;

interface BomRawMaterial extends BomMaterialPrice {
  satuan_besar_id?: string | null;
  satuan_kecil_id?: string | null;
  satuan_besar?: UnitRow | null;
  satuan_kecil?: UnitRow | null;
}

interface ProductBomRow {
  raw_material_id: string | null;
  qty_required: number | string | null;
  waste_factor: number | string | null;
  raw_material: BomRawMaterial | null;
}

interface RawMaterialBomRow {
  component_raw_material_id: string;
  qty_required: number | string | null;
  waste_factor: number | string | null;
  component: unknown;
}

const BOM_SELECT = `
  *,
  raw_material:raw_materials!raw_material_id (*),
  satuan:units!satuan_id (*)
`;

function uniqueIds(ids: Array<string | null | undefined>): string[] {
  return Array.from(new Set(ids.filter((id): id is string => Boolean(id))));
}

/** Harga stok per satuan kecil dari v_raw_materials_stock. */
async function loadSmallUnitCosts(db: DbClient, materialIds: string[]) {
  if (materialIds.length === 0) return new Map<string, number>();
  const { data } = await db
    .from("v_raw_materials_stock")
    .select("id, avg_cost, konversi_factor, satuan_kecil_id")
    .in("id", materialIds);
  return buildStockCostMap((data ?? []) as StockCostRow[], true);
}

/**
 * Query builder hanya mendukung embed satu level, jadi satuan_besar/satuan_kecil
 * bahan di-resolve lewat lookup units terpisah (untuk label tampilan).
 */
async function attachMaterialUnits(db: DbClient, rows: ProductBomRow[]): Promise<void> {
  const unitIds = uniqueIds(
    rows.flatMap((row) => [row.raw_material?.satuan_besar_id, row.raw_material?.satuan_kecil_id])
  );
  const { data: unitRows } =
    unitIds.length > 0 ? await db.from("units").select("*").in("id", unitIds) : { data: [] };
  const unitMap = new Map(((unitRows ?? []) as UnitRow[]).map((unit) => [unit.id, unit]));
  for (const { raw_material: rm } of rows) {
    if (!rm) continue;
    rm.satuan_besar = rm.satuan_besar_id ? unitMap.get(rm.satuan_besar_id) ?? null : null;
    rm.satuan_kecil = rm.satuan_kecil_id ? unitMap.get(rm.satuan_kecil_id) ?? null : null;
  }
}

/** GET /products/:id/bom — baris resep aktif + biaya per satuan kecil. */
export async function listProductBom(db: DbClient, productId: string) {
  const { data, error } = await db
    .from("bom_items", MANUFACTURING_SCHEMA)
    .select(BOM_SELECT)
    .eq("product_id", productId)
    .eq("is_active", true)
    .order("created_at", { ascending: true });
  if (error) throw error;

  const rows = (data ?? []) as ProductBomRow[];
  await attachMaterialUnits(db, rows);
  const stockCosts = await loadSmallUnitCosts(db, uniqueIds(rows.map((row) => row.raw_material_id)));

  return costBomLines(rows, (row) =>
    row.raw_material_id && stockCosts.has(row.raw_material_id)
      ? stockCosts.get(row.raw_material_id) ?? 0
      : fallbackMaterialCost(row.raw_material, true)
  ).lines;
}

/** POST /products/:id/bom */
export async function addProductBomItem(
  db: DbClient,
  productId: string,
  input: ProductBomCreateInput
) {
  const { data: product, error: productError } = await db
    .from("products")
    .select("id")
    .eq("id", productId)
    .single();
  if (productError || !product) throw ApiError.notFound("Produk tidak ditemukan");

  const { data: material, error: materialError } = await db
    .from("raw_materials")
    .select("id, source_product_id")
    .eq("id", input.raw_material_id)
    .eq("is_active", true)
    .single();
  if (materialError || !material) throw ApiError.notFound("Bahan baku tidak ditemukan");

  if ((material as { source_product_id: string | null }).source_product_id === productId) {
    throw ApiError.badRequest(
      "Produk tidak boleh memakai WIP dari produk yang sama sebagai BOM"
    );
  }

  const { data: existingItem } = await db
    .from("bom_items", MANUFACTURING_SCHEMA)
    .select("id")
    .eq("product_id", productId)
    .eq("raw_material_id", input.raw_material_id)
    .eq("is_active", true)
    .maybeSingle();
  if (existingItem) throw ApiError.badRequest("Bahan ini sudah ada di BOM produk");

  const { data, error } = await db
    .from("bom_items", MANUFACTURING_SCHEMA)
    .insert({ ...input, product_id: productId, is_active: true })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** PUT /bom/:id */
export async function updateProductBomItem(
  db: DbClient,
  id: string,
  patch: Record<string, unknown>
) {
  const { data: existingItem, error: findError } = await db
    .from("bom_items", MANUFACTURING_SCHEMA)
    .select("*")
    .eq("id", id)
    .single();
  if (findError || !existingItem) throw ApiError.notFound("Item BOM tidak ditemukan");

  const { data, error } = await db
    .from("bom_items", MANUFACTURING_SCHEMA)
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** DELETE /bom/:id — soft delete (is_active = false). */
export async function deactivateProductBomItem(db: DbClient, id: string): Promise<void> {
  const { error } = await db
    .from("bom_items", MANUFACTURING_SCHEMA)
    .update({ is_active: false })
    .eq("id", id);
  if (error?.code === "PGRST116") throw ApiError.notFound("Item BOM tidak ditemukan");
  if (error) throw error;
}

/** GET /raw-materials/:id/bom — komponen aktif + biaya per satuan kecil. */
export async function listRawMaterialBom(db: DbClient, outputMaterialId: string) {
  const { data, error } = await db
    .from("raw_material_bom_items", MANUFACTURING_SCHEMA)
    .select(`
      *,
      component:raw_materials!component_raw_material_id (*),
      satuan:units!satuan_id (*)
    `)
    .eq("output_raw_material_id", outputMaterialId)
    .eq("is_active", true)
    .order("created_at", { ascending: true });
  if (error) throw error;

  const rows = ((data ?? []) as RawMaterialBomRow[]).map((row) => ({
    ...row,
    raw_material_id: row.component_raw_material_id,
    raw_material: row.component,
  }));
  const stockCosts = await loadSmallUnitCosts(
    db,
    uniqueIds(rows.map((row) => row.component_raw_material_id))
  );
  return costBomLines(rows, (row) => stockCosts.get(row.component_raw_material_id) ?? 0).lines;
}

async function requireActiveRawMaterial(db: DbClient, id: string, notFoundMessage: string) {
  const { data, error } = await db
    .from("raw_materials")
    .select("id")
    .eq("id", id)
    .eq("is_active", true)
    .is("deleted_at", null)
    .single();
  if (error || !data) throw ApiError.notFound(notFoundMessage);
}

/** POST /raw-materials/:id/bom */
export async function addRawMaterialBomItem(
  db: DbClient,
  outputMaterialId: string,
  input: RawMaterialBomCreateInput
) {
  if (input.component_raw_material_id === outputMaterialId) {
    throw ApiError.badRequest("A raw material cannot be a component of itself");
  }
  await requireActiveRawMaterial(db, outputMaterialId, "Output raw material not found");
  await requireActiveRawMaterial(
    db,
    input.component_raw_material_id,
    "Component raw material not found"
  );

  const { data: existingItem } = await db
    .from("raw_material_bom_items", MANUFACTURING_SCHEMA)
    .select("id")
    .eq("output_raw_material_id", outputMaterialId)
    .eq("component_raw_material_id", input.component_raw_material_id)
    .eq("is_active", true)
    .maybeSingle();
  if (existingItem) {
    throw ApiError.badRequest("This component is already in the bill of materials");
  }

  const { data, error } = await db
    .from("raw_material_bom_items", MANUFACTURING_SCHEMA)
    .insert({ output_raw_material_id: outputMaterialId, ...input, is_active: true })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** PUT /raw-material-bom/:id */
export async function updateRawMaterialBomItem(
  db: DbClient,
  id: string,
  patch: Record<string, unknown>
) {
  const { data: existingItem, error: findError } = await db
    .from("raw_material_bom_items", MANUFACTURING_SCHEMA)
    .select("id")
    .eq("id", id)
    .single();
  if (findError || !existingItem) throw ApiError.notFound("Bill of materials item not found");

  const { data, error } = await db
    .from("raw_material_bom_items", MANUFACTURING_SCHEMA)
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** DELETE /raw-material-bom/:id — soft delete. */
export async function deactivateRawMaterialBomItem(db: DbClient, id: string): Promise<void> {
  const { error } = await db
    .from("raw_material_bom_items", MANUFACTURING_SCHEMA)
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}
