import type { DbClient } from "@/lib/pg/types";
import { addInventoryFromGrn } from "@/lib/inventory";
import {
  updateDeliveryStatusAfterGrn,
  updatePOStatusAfterGrn,
  recalculatePoReceivedQty,
  type GrnStatus,
} from "@/lib/purchasing/grn";
import { toQty } from "@/lib/purchasing/utils";
import {
  resolveItemStatus,
  resolveOverallQcStatus,
  type QcOverallStatus,
} from "@/lib/purchasing/grn-qc-utils";
import { createBaseUnitResolver } from "@/lib/purchasing/raw-material-units";
import { packPriceToBase, packToBase } from "@/lib/purchasing/packs";
import { syncQcRejectCredits } from "@/lib/purchasing/vendor-credit-service";
import { requiresSkuOnGrn } from "@/lib/purchasing/variant-po-lines";
import { ApiError } from "@/lib/api/auth";

export type { QcOverallStatus } from "@/lib/purchasing/grn-qc-utils";
export { resolveOverallQcStatus } from "@/lib/purchasing/grn-qc-utils";

export type QcInspectionItemInput = {
  grn_item_id: string;
  raw_material_id?: string | null;
  product_id?: string | null;
  qty_inspected: number;
  qty_accepted: number;
  qty_rejected: number;
  catatan?: string | null;
};

export type SubmitGrnQcInput = {
  grnId: string;
  status: QcOverallStatus;
  parameter_inspeksi?: Record<string, unknown>;
  hasil_inspeksi?: Record<string, string>;
  catatan?: string | null;
  rekomendasi?: string | null;
  items: QcInspectionItemInput[];
  userId: string;
  /** When true, skip RM inventory + product merch posting (caller already posted). */
  skipInventoryPosting?: boolean;
};

export async function computeGrnStatusAfterQc(
  db: DbClient,
  poId: string,
  totalAcceptedInQc: number
): Promise<GrnStatus> {
  if (totalAcceptedInQc <= 0) {
    return "rejected";
  }

  // qty_qc_posted already written on grn_items — rebuild PO qty_received from GRNs.
  await recalculatePoReceivedQty(db, poId);

  const { data: poItems, error } = await db
    .from("purchase_order_items")
    .select("qty_ordered, qty_received")
    .eq("purchase_order_id", poId)
    .eq("is_active", true);

  if (error) throw error;
  if (!poItems?.length) return "partially_received";

  const totalOrdered = poItems.reduce(
    (sum: number, item: { qty_ordered?: number | null; qty_received?: number | null }) =>
      sum + toQty(item.qty_ordered),
    0
  );
  const totalReceived = poItems.reduce(
    (sum: number, item: { qty_ordered?: number | null; qty_received?: number | null }) =>
      sum + toQty(item.qty_received),
    0
  );

  if (totalOrdered > 0 && totalReceived >= totalOrdered) {
    return "received";
  }

  return "partially_received";
}

async function postProductMerchStock(
  db: DbClient,
  productId: string,
  qty: number
): Promise<void> {
  if (qty <= 0) return;
  try {
    const { data: updatedCount, error: stockError } = await db.rpc(
      "pos_receive_merchandise_stock",
      { p_source_product_id: productId, p_qty: qty }
    );

    if (stockError) {
      console.error(
        `[GRN QC] Merch stock posting error for product ${productId} (non-fatal):`,
        stockError
      );
    } else if (Number(updatedCount) === 0) {
      console.warn(
        `[GRN QC] No linked POS merchandise product for item.products ${productId} — stock not posted`
      );
    }
  } catch (stockErr) {
    console.error("[GRN QC] Merch stock posting error (non-fatal):", stockErr);
  }
}

/**
 * EPIC-047 Fase 2 — versi per-SKU dari `postProductMerchStock`. Berbeda dari
 * jalur level-produk di atas: 0 baris ter-update di sini BUKAN kondisi
 * non-fatal — SKU sudah wajib dipilih (guard `requiresSkuOnGrn` di
 * `submitGrnQcInspection`), jadi 0 hanya berarti SKU dinonaktifkan di antara
 * pembuatan GRN dan QC-nya. Itu error nyata, bukan warning yang ditelan.
 */
async function postProductMerchSkuStock(
  db: DbClient,
  skuId: string,
  qty: number
): Promise<void> {
  if (qty <= 0) return;

  const { data: updatedCount, error: stockError } = await db.rpc(
    "pos_receive_merchandise_sku_stock",
    { p_sku_id: skuId, p_qty: qty }
  );

  if (stockError) {
    throw new Error(
      stockError instanceof Error
        ? stockError.message
        : `Gagal memposting stok SKU ${skuId}`
    );
  }

  if (Number(updatedCount) === 0) {
    throw ApiError.badRequest(
      `SKU ${skuId} tidak aktif atau tidak ditemukan — stok tidak dapat diposting`
    );
  }
}

/**
 * EPIC-047 Fase 2 — produk POS merchandise dengan >=1 SKU aktif = produk
 * ber-varian (pola `variant_required` yang sama dipakai di Fase 1A/1B/1C).
 * Satu query gabungan untuk semua productId dalam batch QC ini.
 */
async function resolveVariantProductIds(
  db: DbClient,
  productIds: string[]
): Promise<Set<string>> {
  if (productIds.length === 0) return new Set();

  const { data: posProducts, error: posProductsError } = await db
    .from("pos_products")
    .select("id, source_product_id")
    .eq("product_kind", "merchandise")
    .in("source_product_id", productIds);
  if (posProductsError) throw posProductsError;

  type PosProductRow = { id: string; source_product_id: string };
  const typedPosProducts = (posProducts || []) as PosProductRow[];
  const sourceProductIdByPosProductId = new Map(
    typedPosProducts.map((p) => [p.id, p.source_product_id])
  );
  const posProductIds = typedPosProducts.map((p) => p.id);
  if (posProductIds.length === 0) return new Set();

  const { data: activeSkus, error: activeSkusError } = await db
    .from("pos_product_skus")
    .select("product_id")
    .eq("is_active", true)
    .in("product_id", posProductIds);
  if (activeSkusError) throw activeSkusError;

  type ActiveSkuRow = { product_id: string };
  const variantProductIds = new Set<string>();
  for (const row of (activeSkus || []) as ActiveSkuRow[]) {
    const sourceProductId = sourceProductIdByPosProductId.get(row.product_id);
    if (sourceProductId) variantProductIds.add(sourceProductId);
  }
  return variantProductIds;
}

type GrnItemForQc = {
  id: string;
  raw_material_id?: string | null;
  product_id?: string | null;
  qty_diterima?: number | null;
  satuan_id?: string | null;
  warehouse_id?: string | null;
  qty_qc_posted?: number | null;
  purchase_order_item_id?: string | null;
  purchase_order_item?: { id?: string; harga_satuan?: number | null } | null;
  pos_sku_id?: string | null;
  batch_number?: string | null;
  expiry_date?: string | Date | null;
};
export async function submitGrnQcInspection(
  db: DbClient,
  input: SubmitGrnQcInput
): Promise<{
  inspectionId: string;
  grnStatus: GrnStatus;
  totalAccepted: number;
  totalRejected: number;
  accountingNote?: string | null;
}> {
  const { grnId, userId, items, skipInventoryPosting = false } = input;

  const { data: grn, error: grnError } = await db
    .from("grn")
    .select("id, nomor_grn, status, purchase_order_id, delivery_id")
    .eq("id", grnId)
    .eq("is_active", true)
    .single();

  if (grnError || !grn) {
    throw ApiError.badRequest("GRN not found");
  }

  if (grn.status !== "pending") {
    throw ApiError.badRequest("GRN is not awaiting quality control");
  }

  const { data: existingQc } = await db
    .from("grn_qc_inspections")
    .select("id, inventory_posted")
    .eq("grn_id", grnId)
    .maybeSingle();

  if (existingQc?.inventory_posted) {
    throw ApiError.badRequest("Quality control has already been completed for this goods receipt");
  }

  const { data: grnItems, error: itemsError } = await db
    .from("grn_items")
    .select(
      `
      id,
      raw_material_id,
      product_id,
      qty_diterima,
      satuan_id,
      warehouse_id,
      qty_qc_posted,
      purchase_order_item_id,
      pos_sku_id,
      batch_number,
      expiry_date,
      purchase_order_item:purchase_order_items!purchase_order_item_id(
        id,
        harga_satuan
      )
    `
    )
    .eq("grn_id", grnId)
    .eq("is_active", true);

  if (itemsError) throw itemsError;

  const typedGrnItems = (grnItems || []) as GrnItemForQc[];
  const grnItemMap = new Map(typedGrnItems.map((item) => [item.id, item]));

  // EPIC-047 Fase 2 — Guard: GRN produk ber-varian TANPA pos_sku_id ditolak
  // di sini, sebelum grn_qc_inspections/inspection_items ditulis dan sebelum
  // loop posting stok di bawah berjalan sama sekali — bukan diam-diam nol
  // seperti pos_receive_merchandise_stock versi lama (lihat migration
  // 20260910233939_grn_variant_sku.sql). Satu query gabungan untuk semua
  // productId di batch QC ini.
  const productIdsInBatch = Array.from(
    new Set(
      items
        .map((item) => item.product_id ?? grnItemMap.get(item.grn_item_id)?.product_id ?? null)
        .filter((id): id is string => Boolean(id))
    )
  );
  const variantProductIds = skipInventoryPosting
    ? new Set<string>()
    : await resolveVariantProductIds(db, productIdsInBatch);

  for (const item of items) {
    const grnItem = grnItemMap.get(item.grn_item_id);
    if (!grnItem) {
      throw ApiError.badRequest(`GRN item ${item.grn_item_id} not found`);
    }

    const rawMaterialId = item.raw_material_id ?? grnItem.raw_material_id ?? null;
    const productId = item.product_id ?? grnItem.product_id ?? null;

    if (!rawMaterialId && !productId) {
      throw ApiError.badRequest(`GRN item ${item.grn_item_id} has no raw material or product`);
    }

    const inspected = toQty(item.qty_inspected);
    const accepted = toQty(item.qty_accepted);
    const rejected = toQty(item.qty_rejected);
    const receivedQty = toQty(grnItem.qty_diterima);

    if (inspected <= 0) {
      throw ApiError.badRequest("Inspected quantity must be greater than zero");
    }

    if (Math.abs(accepted + rejected - inspected) > 0.0001) {
      throw ApiError.badRequest("Accepted and rejected quantities must equal inspected quantity");
    }

    if (inspected > receivedQty + 0.0001) {
      throw ApiError.badRequest("Inspected quantity cannot exceed received good quantity");
    }

    if (accepted > receivedQty + 0.0001) {
      throw ApiError.badRequest("Accepted quantity cannot exceed received good quantity");
    }

    if (
      !skipInventoryPosting &&
      productId &&
      requiresSkuOnGrn(variantProductIds.has(productId), grnItem.pos_sku_id)
    ) {
      throw ApiError.badRequest(
        "GRN produk ber-varian wajib menyebut SKU (pos_sku_id)"
      );
    }
  }

  const overallStatus = input.status || resolveOverallQcStatus(items);
  const totalAccepted = items.reduce((sum, item) => sum + toQty(item.qty_accepted), 0);
  const totalRejected = items.reduce((sum, item) => sum + toQty(item.qty_rejected), 0);

  if (existingQc?.id) {
    await db.from("grn_qc_inspection_items").delete().eq("qc_inspection_id", existingQc.id);
    await db.from("grn_qc_inspections").delete().eq("id", existingQc.id);
  }

  const { data: inspection, error: inspectionError } = await db
    .from("grn_qc_inspections")
    .insert({
      grn_id: grnId,
      status: overallStatus,
      parameter_inspeksi: input.parameter_inspeksi || null,
      hasil_inspeksi: input.hasil_inspeksi || null,
      catatan: input.catatan || null,
      rekomendasi: input.rekomendasi || null,
      inspector_id: userId,
      inspected_at: new Date().toISOString(),
      inventory_posted: false,
      created_by: userId,
      updated_by: userId,
    })
    .select("id")
    .single();

  if (inspectionError || !inspection) {
    throw new Error(inspectionError?.message || "Failed to save QC inspection");
  }

  const qcItemsPayload = items.map((item) => {
    const grnItem = grnItemMap.get(item.grn_item_id)!;
    const rawMaterialId = item.raw_material_id ?? grnItem.raw_material_id ?? null;
    const productId = item.product_id ?? grnItem.product_id ?? null;

    return {
      qc_inspection_id: inspection.id,
      grn_item_id: item.grn_item_id,
      raw_material_id: rawMaterialId,
      product_id: productId,
      qty_inspected: toQty(item.qty_inspected),
      qty_accepted: toQty(item.qty_accepted),
      qty_rejected: toQty(item.qty_rejected),
      item_status: resolveItemStatus(toQty(item.qty_accepted), toQty(item.qty_rejected)),
      catatan: item.catatan || null,
    };
  });

  const { error: qcItemsError } = await db
    .from("grn_qc_inspection_items")
    .insert(qcItemsPayload);

  if (qcItemsError) {
    throw new Error(qcItemsError.message || "Failed to save QC line items");
  }

  const resolveBaseUnit = skipInventoryPosting
    ? null
    : await createBaseUnitResolver(
        db,
        items.map(
          (item) =>
            item.raw_material_id ?? grnItemMap.get(item.grn_item_id)?.raw_material_id
        )
      );

  for (const item of items) {
    const grnItem = grnItemMap.get(item.grn_item_id)!;
    const accepted = toQty(item.qty_accepted);
    const itemStatus = resolveItemStatus(accepted, toQty(item.qty_rejected));
    const previouslyPosted = toQty(grnItem.qty_qc_posted);
    const qtyToPost = Math.max(0, accepted - previouslyPosted);
    const rawMaterialId = item.raw_material_id ?? grnItem.raw_material_id ?? null;
    const productId = item.product_id ?? grnItem.product_id ?? null;

    await db
      .from("grn_items")
      .update({
        qc_status: itemStatus,
        qty_qc_posted: accepted,
        updated_at: new Date().toISOString(),
      })
      .eq("id", item.grn_item_id);

    if (skipInventoryPosting || qtyToPost <= 0) continue;

    if (rawMaterialId) {
      const baseUnitFactor = resolveBaseUnit
        ? resolveBaseUnit(rawMaterialId, grnItem.satuan_id)
        : 1;
      const unitCost = toQty(grnItem.purchase_order_item?.harga_satuan);
      const warehouseId = grnItem.warehouse_id ?? null;

      await addInventoryFromGrn(
        db,
        rawMaterialId,
        packToBase(qtyToPost, baseUnitFactor),
        packPriceToBase(unitCost, baseUnitFactor),
        grnId,
        grn.nomor_grn,
        userId,
        warehouseId,
        { batchNumber: grnItem.batch_number, expiryDate: grnItem.expiry_date }
      );
    } else if (productId) {
      if (grnItem.pos_sku_id) {
        // EPIC-047 Fase 2 — produk ber-varian: stok naik pada SKU-nya, bukan
        // level produk. Guard di atas sudah memastikan pos_sku_id ada untuk
        // setiap produk ber-varian sebelum baris ini pernah tercapai.
        await postProductMerchSkuStock(db, grnItem.pos_sku_id, qtyToPost);
      } else {
        await postProductMerchStock(db, productId, qtyToPost);
      }
    }
  }

  const grnStatus = await computeGrnStatusAfterQc(
    db,
    grn.purchase_order_id,
    totalAccepted
  );

  await db
    .from("grn")
    .update({
      status: grnStatus,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", grnId);

  await db
    .from("grn_qc_inspections")
    .update({
      inventory_posted: true,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", inspection.id);

  if (grn.delivery_id) {
    await updateDeliveryStatusAfterGrn(db, grn.delivery_id, grnStatus);
  }

  if (grn.purchase_order_id) {
    await updatePOStatusAfterGrn(db, grn.purchase_order_id);
  }

  try {
    await syncQcRejectCredits(db, grnId, userId);
  } catch (creditErr) {
    console.error("[GRN QC] Vendor credit sync error (non-fatal):", creditErr);
  }

  const { postGrnAccountingJournals } = await import(
    "@/lib/purchasing/accounting-posting"
  );
  const accounting = await postGrnAccountingJournals({
    db,
    grnId,
    userId,
  });

  return {
    inspectionId: inspection.id,
    grnStatus,
    totalAccepted,
    totalRejected,
    accountingNote: accounting.note,
  };
}

/**
 * Build QC payload from create-GRN line items (combined receive+QC).
 * Only lines with qty_diterima > 0 are inspected.
 */
export function buildInlineQcItemsFromCreatedGrn(params: {
  createdItems: Array<{
    id: string;
    purchase_order_item_id?: string | null;
    raw_material_id?: string | null;
    product_id?: string | null;
    qty_diterima?: number | null;
  }>;
  requestItems: Array<{
    raw_material_id?: string | null;
    product_id?: string | null;
    purchase_order_item_id?: string | null;
    qty_diterima: number;
    qty_accepted?: number;
    qty_rejected?: number;
    catatan?: string | null;
  }>;
}): QcInspectionItemInput[] {
  const remaining = [...params.requestItems];
  const result: QcInspectionItemInput[] = [];

  for (const created of params.createdItems) {
    const received = toQty(created.qty_diterima);
    if (received <= 0) continue;

    const idx = remaining.findIndex((req) => {
      if (
        created.purchase_order_item_id &&
        req.purchase_order_item_id === created.purchase_order_item_id
      ) {
        return true;
      }
      if (created.raw_material_id && req.raw_material_id === created.raw_material_id) {
        return true;
      }
      if (created.product_id && req.product_id === created.product_id) {
        return true;
      }
      return false;
    });

    const req = idx >= 0 ? remaining.splice(idx, 1)[0] : null;
    const accepted = req?.qty_accepted != null ? toQty(req.qty_accepted) : received;
    const rejected = req?.qty_rejected != null ? toQty(req.qty_rejected) : Math.max(0, received - accepted);

    result.push({
      grn_item_id: created.id,
      raw_material_id: created.raw_material_id ?? null,
      product_id: created.product_id ?? null,
      qty_inspected: received,
      qty_accepted: accepted,
      qty_rejected: rejected,
      catatan: req?.catatan ?? null,
    });
  }

  return result;
}
