import type { DbClient } from "@/lib/pg/types";
import {
  addInventoryFromGrn,
  reduceInventoryFromPurchaseReturn,
} from "@/lib/inventory";

export type MovementType = "in" | "out" | "adjustment" | "transfer" | "return";
export type ReferenceType =
  | "purchase_order"
  | "grn"
  | "qc_inspection"
  | "return"
  | "adjustment"
  | "delivery";

export interface MovementRecord {
  inventory_id: string;
  /** @deprecated use rawMaterialId — kept for legacy call sites */
  bahan_baku_id: string;
  tipe: MovementType;
  jumlah: number;
  unit_cost?: number;
  total_cost?: number;
  reference_type: ReferenceType;
  reference_id: string;
  sebelum: number;
  sesudah: number;
  alasan?: string;
  catatan?: string;
  created_by: string;
  tanggal_movement?: string;
}

export async function recordMovement(
  db: DbClient,
  movement: MovementRecord
): Promise<void> {
  await db.from("inventory_movements").insert({
    inventory_id: movement.inventory_id,
    raw_material_id: movement.bahan_baku_id,
    tipe: movement.tipe,
    jumlah: movement.jumlah,
    unit_cost: movement.unit_cost ?? null,
    total_cost: movement.total_cost ?? null,
    reference_type: movement.reference_type,
    reference_id: movement.reference_id,
    qty_before: movement.sebelum,
    qty_after: movement.sesudah,
    alasan: movement.alasan ?? null,
    catatan: movement.catatan ?? null,
    created_by: movement.created_by,
    created_at: movement.tanggal_movement ?? new Date().toISOString(),
  });
}

export async function getOrCreateInventory(
  db: DbClient,
  rawMaterialId: string
): Promise<{ id: string; qty_in_stock: number; avg_cost: number }> {
  const { data: existing } = await db
    .from("inventory")
    .select("id, qty_available, unit_cost")
    .eq("raw_material_id", rawMaterialId)
    .eq("is_active", true)
    .maybeSingle();

  if (existing) {
    return {
      id: existing.id,
      qty_in_stock: Number(existing.qty_available || 0),
      avg_cost: Number(existing.unit_cost || 0),
    };
  }

  const { data: newInv, error } = await db
    .from("inventory")
    .insert({
      raw_material_id: rawMaterialId,
      qty_available: 0,
      qty_on_order: 0,
      unit_cost: 0,
    })
    .select("id, qty_available, unit_cost")
    .single();

  if (error || !newInv) {
    throw new Error(`Failed to create inventory record: ${error?.message}`);
  }

  return {
    id: newInv.id,
    qty_in_stock: 0,
    avg_cost: 0,
  };
}

export function calculateWeightedAverage(
  currentQty: number,
  currentAvgCost: number,
  acceptedQty: number,
  unitPrice: number
): number {
  if (currentQty + acceptedQty === 0) return 0;
  const totalCurrentValue = currentQty * currentAvgCost;
  const totalAcceptedValue = acceptedQty * unitPrice;
  return (totalCurrentValue + totalAcceptedValue) / (currentQty + acceptedQty);
}

export async function addStockFromQC(
  db: DbClient,
  params: {
    grnId: string;
    grnItemId: string;
    bahanBakuId: string;
    qtyAccepted: number;
    unitPrice: number;
    userId: string;
  }
): Promise<void> {
  const { grnId, bahanBakuId, qtyAccepted, unitPrice, userId } = params;
  if (qtyAccepted <= 0) return;

  const { data: grn } = await db
    .from("grn")
    .select("nomor_grn")
    .eq("id", grnId)
    .maybeSingle();

  await addInventoryFromGrn(
    db,
    bahanBakuId,
    qtyAccepted,
    unitPrice,
    grnId,
    grn?.nomor_grn || grnId,
    userId
  );
}

export async function reduceStockOnReturn(
  db: DbClient,
  params: {
    returnId: string;
    bahanBakuId: string;
    qtyReturned: number;
    unitCost: number;
    userId: string;
  }
): Promise<void> {
  const { returnId, bahanBakuId, qtyReturned, unitCost, userId } = params;
  if (qtyReturned <= 0) return;

  const { data: purchaseReturn } = await db
    .from("purchase_returns")
    .select("return_number")
    .eq("id", returnId)
    .maybeSingle();

  await reduceInventoryFromPurchaseReturn(db, {
    rawMaterialId: bahanBakuId,
    qtyReturned,
    unitCost,
    returnId,
    returnNumber: purchaseReturn?.return_number || returnId,
    userId,
  });
}
