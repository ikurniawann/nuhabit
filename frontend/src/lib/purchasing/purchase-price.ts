import type { DbClient } from "@/lib/pg/types";
import { toQty } from "@/lib/purchasing/utils";
import {
  createBaseUnitResolver,
  resolveBaseUnitFactor,
  type BaseUnitMaterial,
} from "@/lib/purchasing/raw-material-units";

/**
 * Master `harga_beli` is stored per satuan besar. Inventory / GRN costs are per
 * base unit — scale up when the material defines a small unit.
 */
export function masterHargaBeliFromBaseUnitCost(
  baseUnitCost: number,
  material: BaseUnitMaterial | null | undefined
): number {
  const cost = toQty(baseUnitCost);
  if (cost <= 0) return 0;
  const bigUnitFactor = resolveBaseUnitFactor(
    material,
    [],
    material?.satuan_besar_id
  );
  return cost * (bigUnitFactor > 0 ? bigUnitFactor : 1);
}

/**
 * Sync master purchase-price acuan to the latest GRN transaction cost.
 * Does not touch inventory weighted-average (`unit_cost`).
 */
export async function updateRawMaterialLastPurchasePrice(
  db: DbClient,
  params: {
    rawMaterialId: string;
    baseUnitCost: number;
    userId?: string | null;
  }
): Promise<void> {
  const baseUnitCost = toQty(params.baseUnitCost);
  if (baseUnitCost <= 0) return;

  const { data: material, error: materialError } = await db
    .from("raw_materials")
    .select("id, satuan_besar_id, satuan_kecil_id, konversi_factor")
    .eq("id", params.rawMaterialId)
    .is("deleted_at", null)
    .maybeSingle();

  if (materialError) throw materialError;
  if (!material) return;

  const hargaBeli = masterHargaBeliFromBaseUnitCost(
    baseUnitCost,
    material as BaseUnitMaterial
  );
  if (hargaBeli <= 0) return;

  const { error: updateError } = await db
    .from("raw_materials")
    .update({
      harga_beli: hargaBeli,
      updated_by: params.userId ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.rawMaterialId);

  if (updateError) throw updateError;
}

/**
 * Purchase prices are derived from what the company actually paid on receiving
 * (GRN), not from a maintained price list. Inventory movements already store the
 * cost per base unit, so a suggestion only needs to be scaled to the unit the
 * purchasing document transacts in.
 */
export type PurchasePriceSource = "supplier_grn" | "any_grn" | "master" | null;

export type PurchasePriceSuggestion = {
  raw_material_id: string;
  satuan_id: string | null;
  base_unit_cost: number;
  unit_price: number;
  source: PurchasePriceSource;
  reference_number: string | null;
  purchased_at: string | null;
};

type PurchasePriceRequestItem = {
  raw_material_id: string;
  satuan_id?: string | null;
};

type PurchaseMovement = {
  raw_material_id: string;
  unit_cost: number | null;
  reference_type: string | null;
  reference_id: string | null;
  reference_number: string | null;
  created_at: string;
};

type MaterialRow = {
  id: string;
  satuan_besar_id: string | null;
  satuan_kecil_id: string | null;
  konversi_factor: number | null;
  harga_beli: number | null;
};

const PURCHASE_REFERENCE_TYPES = ["grn", "import"];
const MOVEMENT_SCAN_LIMIT = 500;

type BaseCost = {
  base_unit_cost: number;
  source: PurchasePriceSource;
  reference_number: string | null;
  purchased_at: string | null;
};

async function resolveSupplierGrnIds(
  db: DbClient,
  movements: PurchaseMovement[],
  supplierId?: string | null
): Promise<Set<string>> {
  if (!supplierId) return new Set();

  const grnIds = Array.from(
    new Set(
      movements
        .filter((movement) => movement.reference_type === "grn" && movement.reference_id)
        .map((movement) => movement.reference_id as string)
    )
  );
  if (grnIds.length === 0) return new Set();

  const { data } = await db
    .from("grn")
    .select("id")
    .in("id", grnIds)
    .eq("supplier_id", supplierId);

  return new Set(((data || []) as { id: string }[]).map((row) => row.id));
}

/**
 * Resolves the most recent purchase cost per base unit for each material,
 * preferring receipts from the given supplier and falling back to the master
 * purchase price when the material has never been received.
 */
async function getBaseUnitCosts(
  db: DbClient,
  materialIds: string[],
  options: { supplierId?: string | null; months?: number } = {}
): Promise<Map<string, BaseCost>> {
  const result = new Map<string, BaseCost>();
  if (materialIds.length === 0) return result;

  const months = Math.max(1, options.months ?? 24);
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - months);

  const [{ data: movementRows }, { data: materialRows }] = await Promise.all([
    db
      .from("inventory_movements")
      .select(
        "raw_material_id, unit_cost, reference_type, reference_id, reference_number, created_at"
      )
      .in("raw_material_id", materialIds)
      .eq("tipe", "in")
      .in("reference_type", PURCHASE_REFERENCE_TYPES)
      .gte("created_at", startDate.toISOString())
      .order("created_at", { ascending: false })
      .limit(MOVEMENT_SCAN_LIMIT),
    db
      .from("raw_materials")
      .select("id, satuan_besar_id, satuan_kecil_id, konversi_factor, harga_beli")
      .in("id", materialIds),
  ]);

  const movements = ((movementRows || []) as PurchaseMovement[]).filter(
    (movement) => toQty(movement.unit_cost) > 0
  );
  const supplierGrnIds = await resolveSupplierGrnIds(db, movements, options.supplierId);

  for (const movement of movements) {
    const existing = result.get(movement.raw_material_id);
    const fromSupplier =
      movement.reference_type === "grn" &&
      movement.reference_id !== null &&
      supplierGrnIds.has(movement.reference_id);

    // Movements are ordered newest first, so the first hit per tier wins.
    if (existing && (existing.source === "supplier_grn" || !fromSupplier)) continue;

    result.set(movement.raw_material_id, {
      base_unit_cost: toQty(movement.unit_cost),
      source: fromSupplier ? "supplier_grn" : "any_grn",
      reference_number: movement.reference_number,
      purchased_at: movement.created_at,
    });
  }

  for (const material of (materialRows || []) as MaterialRow[]) {
    if (result.has(material.id)) continue;

    const hargaBeli = toQty(material.harga_beli);
    if (hargaBeli <= 0) continue;

    // harga_beli in the master is priced per satuan besar.
    const bigUnitFactor = resolveBaseUnitFactor(material, [], material.satuan_besar_id);
    result.set(material.id, {
      base_unit_cost: bigUnitFactor > 0 ? hargaBeli / bigUnitFactor : hargaBeli,
      source: "master",
      reference_number: null,
      purchased_at: null,
    });
  }

  return result;
}

export async function getPurchasePriceSuggestions(
  db: DbClient,
  items: PurchasePriceRequestItem[],
  options: { supplierId?: string | null; months?: number } = {}
): Promise<PurchasePriceSuggestion[]> {
  const materialIds = Array.from(
    new Set(items.map((item) => item.raw_material_id).filter(Boolean))
  );
  if (materialIds.length === 0) return [];

  const [baseCosts, resolveBaseUnit] = await Promise.all([
    getBaseUnitCosts(db, materialIds, options),
    createBaseUnitResolver(db, materialIds),
  ]);

  return items.map((item) => {
    const baseCost = baseCosts.get(item.raw_material_id);
    const factor = resolveBaseUnit(item.raw_material_id, item.satuan_id);
    const baseUnitCost = baseCost?.base_unit_cost ?? 0;

    return {
      raw_material_id: item.raw_material_id,
      satuan_id: item.satuan_id ?? null,
      base_unit_cost: baseUnitCost,
      unit_price: baseUnitCost * (factor > 0 ? factor : 1),
      source: baseCost?.source ?? null,
      reference_number: baseCost?.reference_number ?? null,
      purchased_at: baseCost?.purchased_at ?? null,
    };
  });
}
