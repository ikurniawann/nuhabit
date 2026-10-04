import { ApiError } from "@/lib/api/auth";
import { queryOne } from "@/lib/db";
import { addInventoryFromProduction } from "@/lib/inventory";
import { recordFinishedGoodsMovement } from "@/lib/inventory/finished-goods-movements";
import {
  requiresVariantSplit,
  validateVariantSplit,
  type ActiveSku,
  type VariantSplitRow,
} from "@/lib/manufacturing/variant-output";
import type { DbClient } from "@/lib/pg/types";
import { syncProductionHppToPos } from "@/lib/pos/purchasing-sync";
import {
  batchNumber,
  buildWipCode,
  completionMessage,
  resolveMaterialConsumption,
  sumConversionCosts,
  weightedFinishedGoodsCost,
  type MaterialConsumption,
  type ProductionMaterialRow,
} from "@/lib/purchasing/production-calc";
import type { ProductionOrderRow } from "@/lib/purchasing/production-order-actions";
import {
  checkMaterialStock,
  resolveVariantContext,
  type VariantContext,
} from "@/lib/purchasing/production-orders";
import type { UpdateProductionInput } from "@/lib/purchasing/production-schemas";
import { toQty } from "@/lib/purchasing/utils";

interface ProductionContext {
  db: DbClient;
  order: ProductionOrderRow;
  userId: string;
}

/**
 * EPIC-047 Fase 1B: gerbang rincian per varian. Dijalankan SEBELUM tulisan
 * apa pun supaya split yang tidak valid tidak pernah menyisakan perubahan
 * sebagian.
 */
async function resolveVariantSplit(
  { db, order }: ProductionContext,
  actualQty: number,
  variantOutput: VariantSplitRow[] | undefined
): Promise<{ context: VariantContext; rows: VariantSplitRow[] }> {
  const outputType = order.output_type || "FINISHED_GOOD";
  if (order.production_context !== "product" || outputType !== "FINISHED_GOOD") {
    return { context: { posProductId: null, activeSkus: [] }, rows: [] };
  }

  const context = await resolveVariantContext(db, order.product_id);
  if (!requiresVariantSplit(context.activeSkus)) return { context, rows: [] };

  const activeSkus: ActiveSku[] = context.activeSkus.map((sku) => ({
    id: sku.id,
    sku: sku.sku,
    name: sku.name,
    options: sku.options,
  }));
  const result = validateVariantSplit(actualQty, variantOutput ?? null, activeSkus);
  if (!result.ok) throw ApiError.badRequest(result.error, { available_skus: activeSkus });
  return { context, rows: result.rows };
}

const consumedFields = (material: MaterialConsumption) => ({
  qty_actual: material.qtyActual,
  waste_qty: material.wasteQty,
  unit_cost: material.unitCost,
  total_cost: material.totalCost,
});

/** Kurangi stok bahan yang belum dikonsumsi dan catat movement "out" per bahan. */
async function consumeMaterials(
  { db, order, userId }: ProductionContext,
  materials: MaterialConsumption[]
) {
  for (const material of materials) {
    if (material.inventory_movement_id) {
      const { error } = await db
        .from("production_order_materials")
        .update(consumedFields(material))
        .eq("id", material.id);
      if (error) throw error;
      continue;
    }

    const { data: inventory, error: inventoryError } = await db
      .from("inventory")
      .select("id, qty_available, unit_cost, branch_id, warehouse_id")
      .eq("raw_material_id", material.raw_material_id)
      .eq("is_active", true)
      .single();
    if (inventoryError || !inventory) {
      throw ApiError.badRequest(`Inventory bahan ${material.raw_material_id} tidak ditemukan`);
    }

    const qtyBefore = toQty(inventory.qty_available);
    if (qtyBefore < material.qtyActual) {
      throw ApiError.badRequest(`Stok bahan tidak cukup. Sisa ${qtyBefore}, butuh ${material.qtyActual}`);
    }

    const qtyAfter = qtyBefore - material.qtyActual;
    const { data: movement, error: movementError } = await db
      .from("inventory_movements")
      .insert({
        inventory_id: inventory.id,
        raw_material_id: material.raw_material_id,
        tipe: "out",
        jumlah: material.qtyActual,
        qty_before: qtyBefore,
        qty_after: qtyAfter,
        unit_cost: material.unitCost,
        total_cost: material.totalCost,
        branch_id: inventory.branch_id ?? null,
        warehouse_id: inventory.warehouse_id ?? null,
        reference_type: "production",
        reference_id: order.id,
        reference_number: order.nomor_produksi,
        alasan: `Pemakaian bahan untuk produksi ${order.nomor_produksi}`,
        created_by: userId,
      })
      .select("id")
      .single();
    if (movementError) throw movementError;

    const { error: inventoryUpdateError } = await db
      .from("inventory")
      .update({ qty_available: qtyAfter, last_movement_at: new Date().toISOString(), updated_by: userId })
      .eq("id", inventory.id);
    if (inventoryUpdateError) throw inventoryUpdateError;

    const { error: materialUpdateError } = await db
      .from("production_order_materials")
      .update({ ...consumedFields(material), inventory_movement_id: movement.id })
      .eq("id", material.id);
    if (materialUpdateError) throw materialUpdateError;
  }
}

async function ensureWipRawMaterial(
  db: DbClient,
  product: NonNullable<ProductionOrderRow["product"]>,
  userId: string
) {
  const { data: existing, error: existingError } = await db
    .from("raw_materials")
    .select("id")
    .eq("source_product_id", product.id)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing?.id) return existing.id as string;

  const { data, error } = await db
    .from("raw_materials")
    .insert({
      kode: buildWipCode(product.kode),
      nama: product.nama || product.kode || "WIP",
      kategori: "LAINNYA",
      material_type: "WIP",
      source_product_id: product.id,
      satuan_besar_id: product.satuan_id || null,
      satuan_kecil_id: product.satuan_id || null,
      konversi_factor: 1,
      created_by: userId,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

interface BatchFields {
  outputType: string;
  wipRawMaterialId: string | null;
  actualQty: number;
  hppPerUnit: number;
  totalCost: number;
}

/** Batch number deterministik: complete ulang memperbarui batch yang sama. */
async function upsertBatch({ db, order, userId }: ProductionContext, fields: BatchFields) {
  const number = batchNumber(order.nomor_produksi);
  const { data: existingBatch, error: existingBatchError } = await db
    .from("production_batches")
    .select("*")
    .eq("batch_number", number)
    .maybeSingle();
  if (existingBatchError) throw existingBatchError;

  const values = {
    output_type: fields.outputType,
    wip_raw_material_id: fields.wipRawMaterialId,
    qty_produced: fields.actualQty,
    hpp_per_unit: fields.hppPerUnit,
    total_cost: fields.totalCost,
  };
  const { data: batch, error } = existingBatch
    ? await db.from("production_batches").update(values).eq("id", existingBatch.id).select().single()
    : await db
        .from("production_batches")
        .insert({
          production_order_id: order.id,
          product_id: order.product_id,
          output_raw_material_id: order.output_raw_material_id ?? null,
          batch_number: number,
          ...values,
          created_by: userId,
        })
        .select()
        .single();
  if (error) throw error;
  return batch as { id: string } & Record<string, unknown>;
}

interface PostedVariant {
  posSkuId: string;
  qtyBefore: number;
  qtyAfter: number;
}

/**
 * EPIC-047 Fase 1B: posting per SKU. `ON CONFLICT DO NOTHING` pada
 * (production_batch_id, pos_sku_id) membuat posting idempoten: complete kedua
 * kali menemukan batch yang sama dan tidak menaikkan stok SKU lagi.
 */
async function postVariantStock(
  { db, order, userId }: ProductionContext,
  batchId: string,
  posProductId: string,
  rows: VariantSplitRow[]
): Promise<PostedVariant[]> {
  const { data: inserted, error } = await db
    .from("production_output_variants")
    .upsert(
      rows.map((row) => ({
        production_order_id: order.id,
        production_batch_id: batchId,
        pos_sku_id: row.pos_sku_id,
        qty: row.qty,
        created_by: userId,
      }))
    )
    .select("pos_sku_id, qty");
  if (error) throw error;

  const posted: PostedVariant[] = [];
  for (const row of (inserted || []) as Array<{ pos_sku_id: string; qty: number | string }>) {
    const qty = toQty(row.qty);
    const skuUpdate = await queryOne<{ stock_quantity: string }>(
      `UPDATE pos.pos_product_skus
         SET stock_quantity = stock_quantity + $1, updated_at = now()
       WHERE id = $2 AND product_id = $3
       RETURNING stock_quantity`,
      [qty, row.pos_sku_id, posProductId]
    );
    if (!skuUpdate) throw new Error(`SKU ${row.pos_sku_id} tidak ditemukan untuk produk ini`);
    const qtyAfter = toQty(skuUpdate.stock_quantity);
    posted.push({ posSkuId: row.pos_sku_id, qtyBefore: qtyAfter - qty, qtyAfter });
  }
  return posted;
}

/** Tambah stok barang jadi (rata-rata tertimbang) + movement level produk dan per varian. */
async function postFinishedGoods(
  ctx: ProductionContext,
  actualQty: number,
  hppPerUnit: number,
  totalCost: number,
  postedVariants: PostedVariant[]
) {
  const { db, order, userId } = ctx;
  const now = new Date().toISOString();
  const { data: finishedInventory } = await db
    .from("finished_goods_inventory")
    .select("id, qty_available, unit_cost")
    .eq("product_id", order.product_id)
    .maybeSingle();

  let inventoryId: string;
  let qtyBefore = 0;
  let qtyAfter = actualQty;
  let unitCost = hppPerUnit;

  if (finishedInventory) {
    qtyBefore = toQty(finishedInventory.qty_available);
    ({ qtyAfter, unitCost } = weightedFinishedGoodsCost(
      qtyBefore,
      toQty(finishedInventory.unit_cost),
      actualQty,
      totalCost,
      hppPerUnit
    ));
    const { error } = await db
      .from("finished_goods_inventory")
      .update({
        qty_available: qtyAfter,
        unit_cost: unitCost,
        last_movement_at: now,
        updated_by: userId,
        updated_at: now,
      })
      .eq("id", finishedInventory.id);
    if (error) throw error;
    inventoryId = finishedInventory.id;
  } else {
    const { data: created, error } = await db
      .from("finished_goods_inventory")
      .insert({
        product_id: order.product_id,
        qty_available: actualQty,
        unit_cost: hppPerUnit,
        last_movement_at: now,
        created_by: userId,
      })
      .select("id")
      .single();
    if (error || !created) throw error ?? new Error("Gagal membuat stok produk");
    inventoryId = created.id;
  }

  const movementBase = {
    inventoryId,
    productId: order.product_id,
    tipe: "in" as const,
    unitCost,
    referenceType: "production_order",
    referenceId: order.id,
    referenceNumber: order.nomor_produksi,
    alasan: "Production completed",
    userId,
  };
  await recordFinishedGoodsMovement(db, { ...movementBase, qtyBefore, qtyAfter });

  // Satu baris movement TAMBAHAN per varian (pos_sku_id terisi) di atas baris
  // level produk, yang tetap sumber kebenaran total persediaan.
  for (const posted of postedVariants) {
    await recordFinishedGoodsMovement(db, {
      ...movementBase,
      qtyBefore: posted.qtyBefore,
      qtyAfter: posted.qtyAfter,
      catatan: "rincian varian",
      posSkuId: posted.posSkuId,
    });
  }
}

export async function completeProductionOrder(
  db: DbClient,
  order: ProductionOrderRow,
  userId: string,
  input: UpdateProductionInput
) {
  if (order.status !== "IN_PROGRESS") {
    throw ApiError.badRequest("Produksi harus IN_PROGRESS sebelum completed");
  }
  const ctx: ProductionContext = { db, order, userId };
  const actualQty = input.actual_qty || toQty(order.planned_qty);

  const { data: materialData, error: materialsError } = await db
    .from("production_order_materials")
    .select("*")
    .eq("production_order_id", order.id);
  if (materialsError) throw materialsError;
  if (!materialData || materialData.length === 0) {
    throw ApiError.badRequest("Material produksi tidak ditemukan");
  }

  const outputType = order.output_type || "FINISHED_GOOD";
  const variantSplit = await resolveVariantSplit(ctx, actualQty, input.variant_output);

  const overrides = new Map((input.materials || []).map((item) => [item.id, item]));
  const stockCheck = await checkMaterialStock(db, order.id, "actual", overrides);
  if (stockCheck.shortages.length > 0) {
    throw ApiError.badRequest("Stok bahan belum cukup untuk complete produksi", {
      shortages: stockCheck.shortages,
    });
  }

  const materials = resolveMaterialConsumption(materialData as ProductionMaterialRow[], overrides);
  await consumeMaterials(ctx, materials);

  const actualMaterialCost = materials.reduce((sum, material) => sum + material.totalCost, 0);
  const costs = {
    overhead_cost: input.overhead_cost ?? toQty(order.overhead_cost),
    labor_cost: input.labor_cost ?? toQty(order.labor_cost),
    packaging_cost: input.packaging_cost ?? toQty(order.packaging_cost),
    waste_cost: input.waste_cost ?? toQty(order.waste_cost),
  };
  const totalCost = actualMaterialCost + sumConversionCosts(costs);
  const hppPerUnit = totalCost / actualQty;

  const wipRawMaterialId =
    outputType === "WIP" && order.product ? await ensureWipRawMaterial(db, order.product, userId) : null;
  const batch = await upsertBatch(ctx, { outputType, wipRawMaterialId, actualQty, hppPerUnit, totalCost });

  if (order.production_context === "raw_material" && order.output_raw_material_id) {
    await addInventoryFromProduction(
      db,
      order.output_raw_material_id,
      actualQty,
      hppPerUnit,
      order.id,
      order.nomor_produksi,
      userId,
      "production_output"
    );
  } else if (outputType === "WIP" && wipRawMaterialId) {
    await addInventoryFromProduction(db, wipRawMaterialId, actualQty, hppPerUnit, order.id, order.nomor_produksi, userId);
  } else {
    const { context, rows } = variantSplit;
    const postedVariants =
      rows.length > 0 && context.posProductId
        ? await postVariantStock(ctx, batch.id, context.posProductId, rows)
        : [];
    await postFinishedGoods(ctx, actualQty, hppPerUnit, totalCost, postedVariants);
  }

  const now = new Date().toISOString();
  const { data: updatedOrder, error: completeError } = await db
    .from("production_orders")
    .update({
      status: "COMPLETED",
      actual_qty: actualQty,
      actual_material_cost: actualMaterialCost,
      ...costs,
      hpp_per_unit: hppPerUnit,
      completed_at: now,
      updated_by: userId,
      updated_at: now,
    })
    .eq("id", order.id)
    .select()
    .single();
  if (completeError) throw completeError;

  const posSync =
    order.production_context !== "raw_material" && outputType === "FINISHED_GOOD"
      ? await syncProductionHppToPos(db, order.product_id, hppPerUnit)
      : null;

  return {
    data: { order: updatedOrder, batch, pos_sync: posSync },
    message: completionMessage(order.nomor_produksi, hppPerUnit, posSync ? posSync.margin_percentage : null),
  };
}
