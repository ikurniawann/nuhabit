import type { RawMaterialWithStock } from "@/types/purchasing";
import { toNumber } from "./production-ui-display";
import { materialUnitCost } from "./product-ui-form";
import type { RawMaterialBomRow } from "./production-ui-types";

/** Baris editor BOM bahan baku; `persisted` = sudah tersimpan di server. waste_factor pecahan (0.05 = 5%). */
export type BomDraft = {
  id: string;
  raw_material_id: string;
  qty_required: number;
  waste_factor: number;
  cost_per_unit: number;
  total_cost: number;
  persisted: boolean;
};

export function bomDraftFromRow(row: RawMaterialBomRow): BomDraft {
  const qtyRequired = toNumber(row.qty_required);
  const wasteFactor = toNumber(row.waste_factor);
  const costPerUnit = toNumber(row.cost_per_unit);
  return {
    id: row.id,
    raw_material_id: row.raw_material_id || row.component_raw_material_id || "",
    qty_required: qtyRequired,
    waste_factor: wasteFactor,
    cost_per_unit: costPerUnit,
    total_cost: toNumber(row.total_cost) || costPerUnit * qtyRequired * (1 + wasteFactor),
    persisted: true,
  };
}

/** Hitung ulang biaya baris dari harga komponen (per satuan kecil) dan susut. */
export function recalculateBomDraft(item: BomDraft, component: RawMaterialWithStock | undefined): BomDraft {
  const costPerUnit = materialUnitCost(component);
  return {
    ...item,
    cost_per_unit: costPerUnit,
    total_cost: costPerUnit * item.qty_required * (1 + item.waste_factor),
  };
}

export function newBomDraft(id: string): BomDraft {
  return {
    id,
    raw_material_id: "",
    qty_required: 1,
    waste_factor: 0,
    cost_per_unit: 0,
    total_cost: 0,
    persisted: false,
  };
}

/** Validasi sebelum simpan; mengembalikan pesan error atau null. */
export function bomDraftError(item: BomDraft): string | null {
  if (!item.raw_material_id) return "Bahan komponen wajib diisi";
  if (item.qty_required <= 0) return "Qty harus lebih dari 0";
  return null;
}
