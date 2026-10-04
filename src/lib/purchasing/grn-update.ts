/** PATCH/DELETE /api/purchasing/grn/[id]: GRN Continue (tambah qty) dan hapus GRN. */
import { ApiError } from "@/lib/api/auth";
import { toDateOnly } from "@/lib/inventory/batches";
import type { DbClient } from "@/lib/pg/types";
import {
  updateDeliveryStatusAfterGrn,
  updatePOStatusAfterGrn,
  validateGrnTransition,
  type GrnStatus,
} from "@/lib/purchasing/grn";
import {
  grnLineKey,
  statusFromLines,
  validateAdditionalReceive,
  type PoItemForReceive,
} from "@/lib/purchasing/grn-receive-rules";
import type { UpdateGrnInput, UpdateGrnItemInput } from "@/lib/purchasing/grn-schemas";
import { toQty } from "@/lib/purchasing/utils";
import { syncReceiveRejectCredits } from "@/lib/purchasing/vendor-credit-service";

type ExistingGrnItem = {
  purchase_order_item_id: string | null;
  raw_material_id: string | null;
  qty_diterima: number | string | null;
  qty_ditolak: number | string | null;
  warehouse_id: string | null;
  qty_qc_posted: number | string | null;
  batch_number: string | null;
  expiry_date: string | Date | null;
};

type GrnHeaderUpdate = {
  updated_by: string;
  updated_at: string;
  status?: GrnStatus;
  catatan?: string;
  tanggal_penerimaan?: string;
  total_item_diterima?: number;
  total_item_ditolak?: number;
};

/** Ada baris yang qty diterimanya berubah dibanding yang tersimpan? */
export function hasReceivedQtyChange(
  items: UpdateGrnItemInput[],
  existingByKey: Map<string, Pick<ExistingGrnItem, "qty_diterima">>
): boolean {
  return items.some(
    (item) => item.qty_diterima - toQty(existingByKey.get(grnLineKey(item))?.qty_diterima) !== 0
  );
}

/**
 * Header GRN setelah edit. Total & status dihitung ulang dari baris; perubahan
 * qty pada GRN yang sudah lewat QC membuka ulang QC (status kembali pending).
 */
export function buildGrnHeaderUpdate(params: {
  input: UpdateGrnInput;
  userId: string;
  currentStatus: string;
  qtyChanged: boolean;
  now: string;
}): GrnHeaderUpdate {
  const { input, qtyChanged, currentStatus } = params;
  const update: GrnHeaderUpdate = { updated_by: params.userId, updated_at: params.now };

  if (input.status) update.status = input.status;
  if (input.catatan !== undefined) update.catatan = input.catatan;
  if (input.tanggal_penerimaan) update.tanggal_penerimaan = input.tanggal_penerimaan;

  if (input.items?.length) {
    update.total_item_diterima = input.items.reduce((sum, item) => sum + item.qty_diterima, 0);
    update.total_item_ditolak = input.items.reduce((sum, item) => sum + item.qty_ditolak, 0);
    update.status = statusFromLines(input.items) ?? update.status;
  }

  if (qtyChanged && currentStatus !== "pending") update.status = "pending";
  return update;
}

async function loadPoItemsForValidation(db: DbClient, poId: string): Promise<PoItemForReceive[]> {
  const { data, error } = await db
    .from("purchase_order_items")
    .select("id, raw_material_id, qty_ordered, qty_received, raw_material:raw_materials!raw_material_id(nama)")
    .eq("purchase_order_id", poId)
    .eq("is_active", true);
  if (error) throw error;
  return (data || []) as PoItemForReceive[];
}

async function deleteQcInspection(db: DbClient, grnId: string): Promise<void> {
  const { data: existingQc } = await db
    .from("grn_qc_inspections")
    .select("id")
    .eq("grn_id", grnId)
    .maybeSingle();

  if (existingQc?.id) {
    await db.from("grn_qc_inspection_items").delete().eq("qc_inspection_id", existingQc.id);
    await db.from("grn_qc_inspections").delete().eq("id", existingQc.id);
  }
}

/** Ganti baris GRN; gudang & qty QC yang sudah diposting dipertahankan untuk posting stok delta. */
async function replaceGrnItems(
  db: DbClient,
  grn: { id: string; delivery_id: string | null },
  items: UpdateGrnItemInput[],
  existingByKey: Map<string, ExistingGrnItem>
): Promise<void> {
  const { error: deactivateError } = await db
    .from("grn_items")
    .update({ is_active: false })
    .eq("grn_id", grn.id);
  if (deactivateError) throw deactivateError;

  const rows = items.map((item) => {
    const existing = existingByKey.get(grnLineKey(item));
    return {
      grn_id: grn.id,
      delivery_id: grn.delivery_id,
      purchase_order_item_id: item.purchase_order_item_id,
      raw_material_id: item.raw_material_id,
      qty_diterima: item.qty_diterima,
      qty_ditolak: item.qty_ditolak,
      kondisi: item.kondisi,
      catatan: item.catatan || null,
      warehouse_id: existing?.warehouse_id ?? null,
      qc_status: "pending",
      qty_qc_posted: existing?.qty_qc_posted ?? 0,
      batch_number: item.batch_number?.trim() || existing?.batch_number || null,
      expiry_date: item.expiry_date || toDateOnly(existing?.expiry_date),
    };
  });

  const { error: insertError } = await db.from("grn_items").insert(rows);
  if (insertError) throw insertError;
}

export async function updateGrn(db: DbClient, id: string, input: UpdateGrnInput, userId: string) {
  const { data: current, error: fetchError } = await db
    .from("grn")
    .select("*")
    .eq("id", id)
    .eq("is_active", true)
    .single();
  if (fetchError || !current) throw ApiError.notFound("GRN tidak ditemukan");

  if (input.status && input.status !== current.status) {
    validateGrnTransition(current.status as GrnStatus, input.status);
  }

  const { data: existingRows } = await db
    .from("grn_items")
    .select("*")
    .eq("grn_id", id)
    .eq("is_active", true);
  const existingByKey = new Map(
    ((existingRows || []) as ExistingGrnItem[]).map((item) => [grnLineKey(item), item])
  );

  const items = input.items ?? [];
  if (items.length > 0) {
    const poItems = await loadPoItemsForValidation(db, current.purchase_order_id);
    validateAdditionalReceive(items, poItems, existingByKey);
    if (!items.some((item) => item.purchase_order_item_id)) {
      throw ApiError.badRequest("Minimal 1 item harus terhubung dengan item PO");
    }
  }

  const qtyChanged = hasReceivedQtyChange(items, existingByKey);
  const update = buildGrnHeaderUpdate({
    input,
    userId,
    currentStatus: current.status,
    qtyChanged,
    now: new Date().toISOString(),
  });
  if (qtyChanged && current.status !== "pending") await deleteQcInspection(db, id);

  const { data: grn, error } = await db.from("grn").update(update).eq("id", id).select().single();
  if (error) throw error;

  if (items.length > 0) await replaceGrnItems(db, current, items, existingByKey);

  if (update.status && update.status !== "pending" && current.delivery_id) {
    await updateDeliveryStatusAfterGrn(db, current.delivery_id, update.status);
  }
  // Hitung ulang qty_received item PO dari semua GRN aktif, lalu status PO.
  if (current.purchase_order_id) await updatePOStatusAfterGrn(db, current.purchase_order_id);

  try {
    await syncReceiveRejectCredits(db, id, userId);
  } catch (creditErr) {
    console.error(`[PATCH GRN/${id}] Vendor credit sync error (non-fatal):`, creditErr);
  }

  return grn;
}

/** Soft delete GRN + barisnya; qty_received PO dihitung ulang dari GRN yang tersisa. */
export async function deleteGrn(db: DbClient, id: string, userId: string) {
  const { data: grn, error: grnError } = await db
    .from("grn")
    .select("*")
    .eq("id", id)
    .eq("is_active", true)
    .single();
  if (grnError || !grn) throw ApiError.notFound("GRN tidak ditemukan");

  await db.from("grn_items").update({ is_active: false }).eq("grn_id", id);
  const { data: deleted, error } = await db
    .from("grn")
    .update({ is_active: false, updated_by: userId })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;

  if (grn.purchase_order_id) await updatePOStatusAfterGrn(db, grn.purchase_order_id);

  return { deleted, nomorGrn: grn.nomor_grn as string };
}
