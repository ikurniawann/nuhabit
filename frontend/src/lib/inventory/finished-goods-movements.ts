import type { DbClient } from "@/lib/pg/types";
import { queryOne } from "@/lib/db";

export type FinishedGoodsMovementType =
  | "in"
  | "out"
  | "adjustment"
  | "transfer"
  | "return";

type PgClientLike = DbClient | {
  from: DbClient["from"];
};

function toNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

async function resolveProductScope(productId: string) {
  return queryOne<{
    warehouse_id: string | null;
    branch_id: string | null;
  }>(
    `SELECT warehouse_id, branch_id
     FROM item.products
     WHERE id = $1
       AND deleted_at IS NULL`,
    [productId]
  );
}

/**
 * Insert a finished-goods movement row (does not change balance).
 * Call after updating finished_goods_inventory.
 */
export async function recordFinishedGoodsMovement(
  db: PgClientLike,
  params: {
    inventoryId: string;
    productId: string;
    tipe: FinishedGoodsMovementType;
    qtyBefore: number;
    qtyAfter: number;
    unitCost?: number | null;
    referenceType?: string | null;
    referenceId?: string | null;
    referenceNumber?: string | null;
    alasan?: string | null;
    catatan?: string | null;
    userId?: string | null;
    warehouseId?: string | null;
    branchId?: string | null;
    // EPIC-047 Fase 1B — diisi untuk baris rincian per varian
    // (pos.pos_product_skus); null/undefined untuk baris level produk lama.
    posSkuId?: string | null;
  }
) {
  const qtyBefore = toNumber(params.qtyBefore);
  const qtyAfter = toNumber(params.qtyAfter);
  const jumlah = Math.abs(qtyAfter - qtyBefore);
  if (jumlah === 0) return null;

  let warehouseId = params.warehouseId ?? null;
  let branchId = params.branchId ?? null;
  if (!warehouseId || !branchId) {
    const scope = await resolveProductScope(params.productId);
    warehouseId = warehouseId ?? scope?.warehouse_id ?? null;
    branchId = branchId ?? scope?.branch_id ?? null;
  }

  const unitCost = toNumber(params.unitCost);
  const totalCost = jumlah * unitCost;
  const now = new Date().toISOString();

  const { data, error } = await db
    .from("finished_goods_movements")
    .insert({
      inventory_id: params.inventoryId,
      product_id: params.productId,
      warehouse_id: warehouseId,
      branch_id: branchId,
      tipe: params.tipe,
      jumlah,
      qty_before: qtyBefore,
      qty_after: qtyAfter,
      unit_cost: unitCost,
      total_cost: totalCost,
      reference_type: params.referenceType ?? null,
      reference_id: params.referenceId ?? null,
      reference_number: params.referenceNumber ?? null,
      alasan: params.alasan ?? null,
      catatan: params.catatan ?? null,
      pos_sku_id: params.posSkuId ?? null,
      is_active: true,
      created_by: params.userId ?? null,
      updated_by: params.userId ?? null,
      created_at: now,
      updated_at: now,
    })
    .select("id")
    .single();

  if (error) throw error;
  return data;
}

/** Raw SQL insert for use inside withTransaction(client). */
export async function insertFinishedGoodsMovementSql(
  client: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  params: {
    inventoryId: string;
    productId: string;
    warehouseId?: string | null;
    branchId?: string | null;
    tipe: FinishedGoodsMovementType;
    qtyBefore: number;
    qtyAfter: number;
    unitCost?: number | null;
    referenceType?: string | null;
    referenceId?: string | null;
    referenceNumber?: string | null;
    alasan?: string | null;
    catatan?: string | null;
    userId?: string | null;
    // EPIC-047 Fase 1B — diisi untuk baris rincian per varian
    // (pos.pos_product_skus); null/undefined untuk baris level produk lama.
    posSkuId?: string | null;
  }
) {
  const qtyBefore = toNumber(params.qtyBefore);
  const qtyAfter = toNumber(params.qtyAfter);
  const jumlah = Math.abs(qtyAfter - qtyBefore);
  if (jumlah === 0) return;

  let warehouseId = params.warehouseId ?? null;
  let branchId = params.branchId ?? null;
  if (!warehouseId || !branchId) {
    const scope = await resolveProductScope(params.productId);
    warehouseId = warehouseId ?? scope?.warehouse_id ?? null;
    branchId = branchId ?? scope?.branch_id ?? null;
  }

  const unitCost = toNumber(params.unitCost);
  await client.query(
    `INSERT INTO inventory.finished_goods_movements
       (inventory_id, product_id, warehouse_id, branch_id, tipe, jumlah,
        qty_before, qty_after, unit_cost, total_cost,
        reference_type, reference_id, reference_number, alasan, catatan,
        pos_sku_id, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,true,$17,$17)`,
    [
      params.inventoryId,
      params.productId,
      warehouseId,
      branchId,
      params.tipe,
      jumlah,
      qtyBefore,
      qtyAfter,
      unitCost,
      jumlah * unitCost,
      params.referenceType ?? null,
      params.referenceId ?? null,
      params.referenceNumber ?? null,
      params.alasan ?? null,
      params.catatan ?? null,
      params.posSkuId ?? null,
      params.userId ?? null,
    ]
  );
}
