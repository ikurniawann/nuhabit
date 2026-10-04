// EPIC-026 Task C1 — Service inventory riil barang operasional (scope 'general').
//
// Domain-paralel dari src/lib/purchasing/inventory.ts + src/lib/inventory/index.ts
// (raw material), tetapi key = supply_item_id dan tabel inventory.supply_inventory /
// inventory.supply_inventory_movements. Stok PER GUDANG, costing rata-rata tertimbang.
//
// Hanya dipanggil untuk item stockable=true. Costing memakai calculateWeightedAverage()
// yang sudah ada di ./inventory.

import { ApiError } from "@/lib/api/auth";
import type { DbClient } from "@/lib/pg/types";
import { toQty } from "@/lib/purchasing/utils";
import { calculateWeightedAverage } from "@/lib/purchasing/inventory";

export type SupplyMovementType = "in" | "out" | "adjustment" | "return";
export type SupplyReferenceType =
  | "grn"
  | "usage"
  | "adjustment"
  | "opname"
  | "return";

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

interface SupplyInventoryRow {
  id: string;
  qty_available: number;
  qty_on_order: number;
  unit_cost: number;
}

/** Cari branch_id gudang (untuk mengisi scope baris stok). */
async function resolveWarehouseBranch(
  db: DbClient,
  warehouseId: string | null
): Promise<string | null> {
  if (!warehouseId) return null;
  const { data } = await db
    .from("warehouses", "configuration")
    .select("branch_id")
    .eq("id", warehouseId)
    .maybeSingle();
  return (data as { branch_id: string | null } | null)?.branch_id ?? null;
}

/**
 * Ambil (atau buat) baris saldo stok untuk (supply_item, gudang). Matching gudang
 * memakai COALESCE agar warehouse NULL konsisten dengan unique index migrasi.
 */
export async function getOrCreateSupplyInventory(
  db: DbClient,
  params: {
    supplyItemId: string;
    warehouseId: string | null;
    companyId?: string | null;
    branchId?: string | null;
    userId?: string | null;
  }
): Promise<SupplyInventoryRow> {
  const { supplyItemId, warehouseId, companyId, userId } = params;
  const branchId = params.branchId ?? (await resolveWarehouseBranch(db, warehouseId));

  // Query builder tak mendukung COALESCE, jadi ambil baris item lalu match gudang
  // di memori (konsisten dengan unique index COALESCE(warehouse_id, ZERO_UUID)).
  const { data: rows } = await db
    .from("supply_inventory")
    .select("id, qty_available, qty_on_order, unit_cost, warehouse_id")
    .eq("supply_item_id", supplyItemId)
    .eq("is_active", true);

  const match = (rows ?? []).find(
    (r: { warehouse_id: string | null }) =>
      (r.warehouse_id ?? ZERO_UUID) === (warehouseId ?? ZERO_UUID)
  );

  if (match) {
    return {
      id: match.id,
      qty_available: toQty(match.qty_available),
      qty_on_order: toQty(match.qty_on_order),
      unit_cost: toQty(match.unit_cost),
    };
  }

  const { data: created, error } = await db
    .from("supply_inventory")
    .insert({
      supply_item_id: supplyItemId,
      warehouse_id: warehouseId,
      qty_available: 0,
      qty_on_order: 0,
      unit_cost: 0,
      company_id: companyId ?? null,
      branch_id: branchId,
      created_by: userId ?? null,
    })
    .select("id, qty_available, qty_on_order, unit_cost")
    .single();

  if (error || !created) {
    throw new Error(`Gagal membuat baris stok barang operasional: ${error?.message}`);
  }

  return {
    id: created.id,
    qty_available: toQty(created.qty_available),
    qty_on_order: toQty(created.qty_on_order),
    unit_cost: toQty(created.unit_cost),
  };
}

interface RecordMovementInput {
  supplyInventoryId: string;
  supplyItemId: string;
  warehouseId: string | null;
  tipe: SupplyMovementType;
  jumlah: number;
  qtyBefore: number;
  qtyAfter: number;
  unitCost?: number | null;
  totalCost?: number | null;
  referenceType: SupplyReferenceType;
  referenceId?: string | null;
  referenceNumber?: string | null;
  alasan?: string | null;
  catatan?: string | null;
  companyId?: string | null;
  branchId?: string | null;
  userId?: string | null;
}

export async function recordSupplyMovement(
  db: DbClient,
  m: RecordMovementInput
): Promise<void> {
  await db.from("supply_inventory_movements").insert({
    supply_inventory_id: m.supplyInventoryId,
    supply_item_id: m.supplyItemId,
    warehouse_id: m.warehouseId,
    tipe: m.tipe,
    jumlah: m.jumlah,
    qty_before: m.qtyBefore,
    qty_after: m.qtyAfter,
    unit_cost: m.unitCost ?? null,
    total_cost: m.totalCost ?? null,
    reference_type: m.referenceType,
    reference_id: m.referenceId ?? null,
    reference_number: m.referenceNumber ?? null,
    alasan: m.alasan ?? null,
    catatan: m.catatan ?? null,
    company_id: m.companyId ?? null,
    branch_id: m.branchId ?? null,
    created_by: m.userId ?? null,
  });
}

/**
 * Posting stok MASUK dari penerimaan (GRN). Update saldo + rata-rata tertimbang,
 * kurangi qty_on_order, dan catat movement 'in'. No-op bila qty ≤ 0.
 */
export async function addSupplyStockFromGrn(
  db: DbClient,
  params: {
    supplyItemId: string;
    warehouseId: string | null;
    qtyReceived: number;
    unitCost: number;
    grnId: string;
    grnNumber: string;
    companyId?: string | null;
    branchId?: string | null;
    userId?: string | null;
  }
): Promise<void> {
  const qty = toQty(params.qtyReceived);
  const cost = toQty(params.unitCost);
  if (qty <= 0) return;

  const branchId =
    params.branchId ?? (await resolveWarehouseBranch(db, params.warehouseId));

  const inv = await getOrCreateSupplyInventory(db, {
    supplyItemId: params.supplyItemId,
    warehouseId: params.warehouseId,
    companyId: params.companyId,
    branchId,
    userId: params.userId,
  });

  const qtyBefore = inv.qty_available;
  const qtyAfter = qtyBefore + qty;
  const newUnitCost = calculateWeightedAverage(qtyBefore, inv.unit_cost, qty, cost);

  const { error: updateError } = await db
    .from("supply_inventory")
    .update({
      qty_available: qtyAfter,
      qty_on_order: Math.max(0, inv.qty_on_order - qty),
      unit_cost: newUnitCost,
      last_movement_at: new Date().toISOString(),
      updated_by: params.userId ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", inv.id);

  if (updateError) throw updateError;

  await recordSupplyMovement(db, {
    supplyInventoryId: inv.id,
    supplyItemId: params.supplyItemId,
    warehouseId: params.warehouseId,
    tipe: "in",
    jumlah: qty,
    qtyBefore,
    qtyAfter,
    unitCost: newUnitCost,
    totalCost: qty * newUnitCost,
    referenceType: "grn",
    referenceId: params.grnId,
    referenceNumber: params.grnNumber,
    alasan: `Penerimaan barang dari GRN ${params.grnNumber}`,
    companyId: params.companyId,
    branchId,
    userId: params.userId,
  });
}

/**
 * Kurangi stok karena pemakaian/pengeluaran ('out'). Melempar bila saldo kurang.
 */
export async function reduceSupplyStock(
  db: DbClient,
  params: {
    supplyItemId: string;
    warehouseId: string | null;
    qty: number;
    referenceType: SupplyReferenceType;
    referenceId?: string | null;
    referenceNumber?: string | null;
    alasan?: string | null;
    catatan?: string | null;
    companyId?: string | null;
    branchId?: string | null;
    userId?: string | null;
  }
): Promise<{ unitCost: number }> {
  const qty = toQty(params.qty);
  if (qty <= 0) return { unitCost: 0 };

  const branchId =
    params.branchId ?? (await resolveWarehouseBranch(db, params.warehouseId));

  const inv = await getOrCreateSupplyInventory(db, {
    supplyItemId: params.supplyItemId,
    warehouseId: params.warehouseId,
    companyId: params.companyId,
    branchId,
    userId: params.userId,
  });

  const qtyBefore = inv.qty_available;
  if (qty > qtyBefore) {
    throw ApiError.badRequest(`Stok tidak cukup (tersedia ${qtyBefore}, diminta ${qty})`);
  }
  const qtyAfter = qtyBefore - qty;

  const { error: updateError } = await db
    .from("supply_inventory")
    .update({
      qty_available: qtyAfter,
      last_movement_at: new Date().toISOString(),
      updated_by: params.userId ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", inv.id);

  if (updateError) throw updateError;

  await recordSupplyMovement(db, {
    supplyInventoryId: inv.id,
    supplyItemId: params.supplyItemId,
    warehouseId: params.warehouseId,
    tipe: "out",
    jumlah: qty,
    qtyBefore,
    qtyAfter,
    unitCost: inv.unit_cost,
    totalCost: qty * inv.unit_cost,
    referenceType: params.referenceType,
    referenceId: params.referenceId ?? null,
    referenceNumber: params.referenceNumber ?? null,
    alasan: params.alasan ?? null,
    catatan: params.catatan ?? null,
    companyId: params.companyId,
    branchId,
    userId: params.userId,
  });

  return { unitCost: inv.unit_cost };
}

/**
 * Penyesuaian stok ke nilai aktual (opname/koreksi). Mencatat selisih sebagai
 * movement 'adjustment'. No-op bila tak ada selisih.
 */
export async function adjustSupplyStock(
  db: DbClient,
  params: {
    supplyItemId: string;
    warehouseId: string | null;
    qtyActual: number;
    referenceType?: SupplyReferenceType;
    alasan?: string | null;
    catatan?: string | null;
    companyId?: string | null;
    branchId?: string | null;
    userId?: string | null;
  }
): Promise<{ qtyBefore: number; qtyAfter: number; qtyDiff: number }> {
  const qtyActual = toQty(params.qtyActual);
  const branchId =
    params.branchId ?? (await resolveWarehouseBranch(db, params.warehouseId));

  const inv = await getOrCreateSupplyInventory(db, {
    supplyItemId: params.supplyItemId,
    warehouseId: params.warehouseId,
    companyId: params.companyId,
    branchId,
    userId: params.userId,
  });

  const qtyBefore = inv.qty_available;
  const qtyDiff = qtyActual - qtyBefore;

  const { error: updateError } = await db
    .from("supply_inventory")
    .update({
      qty_available: qtyActual,
      last_movement_at: new Date().toISOString(),
      updated_by: params.userId ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", inv.id);

  if (updateError) throw updateError;

  if (qtyDiff !== 0) {
    await recordSupplyMovement(db, {
      supplyInventoryId: inv.id,
      supplyItemId: params.supplyItemId,
      warehouseId: params.warehouseId,
      tipe: "adjustment",
      jumlah: Math.abs(qtyDiff),
      qtyBefore,
      qtyAfter: qtyActual,
      unitCost: inv.unit_cost,
      totalCost: Math.abs(qtyDiff) * inv.unit_cost,
      referenceType: params.referenceType ?? "adjustment",
      alasan: params.alasan ?? `Penyesuaian stok: ${qtyDiff > 0 ? "+" : ""}${qtyDiff}`,
      catatan: params.catatan ?? null,
      companyId: params.companyId,
      branchId,
      userId: params.userId,
    });
  }

  return { qtyBefore, qtyAfter: qtyActual, qtyDiff };
}
