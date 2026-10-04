import { ApiError } from "@/lib/api/auth";
import type { DbClient } from "@/lib/pg/types";
import { toQty } from "@/lib/purchasing/utils";

// ============================================================
// GRN State Machine
// pending → received / partially_received / rejected
// ============================================================

export type GrnStatus = "pending" | "partially_received" | "received" | "rejected";

type DeliveryForGrn = {
  vendor_id?: string | null;
  id: string;
  purchase_order_id?: string | null;
  supplier_id?: string | null;
  no_surat_jalan?: string | null;
  status?: string | null;
};

type POItemForGrn = {
  id: string;
  raw_material_id?: string | null;
  product_id?: string | null;
  qty_ordered?: number | null;
  qty_received?: number | null;
  harga_satuan?: number | null;
  unit_price?: number | null;
  raw_material?: {
    id: string;
    nama: string;
  } | null;
  product?: {
    id: string;
    nama: string;
  } | null;
};

export const GRN_TRANSITIONS: Record<GrnStatus, GrnStatus[]> = {
  pending: ["received", "partially_received", "rejected"],
  partially_received: ["received", "pending"],
  received: [],
  rejected: [],
};

export function validateGrnTransition(from: GrnStatus, to: GrnStatus): void {
  const allowed = GRN_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw ApiError.badRequest(`Invalid GRN transition: ${from} → ${to}`);
  }
}

// ============================================================
// Generate GRN Number
// Format: GRN-YYYYMMDD-XXXX
// ============================================================

export async function generateGrnNumber(db: DbClient): Promise<string> {
  const today = new Date();
  const datePrefix = `GRN-${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;

  // Ambil sequence terakhir agar aman jika ada nomor yang pernah dihapus/skip.
  const { data } = await db
    .from("grn")
    .select("nomor_grn")
    .ilike("nomor_grn", `${datePrefix}-%`)
    .order("nomor_grn", { ascending: false })
    .limit(1);

  let sequence = 1;
  if (data && data.length > 0) {
    const lastSeq = Number.parseInt(data[0].nomor_grn.split("-").at(-1) || "", 10);
    if (Number.isFinite(lastSeq)) sequence = lastSeq + 1;
  }

  return `${datePrefix}-${String(sequence).padStart(4, "0")}`;
}

// ============================================================
// Validate Delivery can be received
// ============================================================

export async function validateDeliveryCanReceive(
  db: DbClient,
  deliveryId: string
): Promise<{ valid: boolean; errors: string[]; delivery?: DeliveryForGrn; items?: POItemForGrn[] }> {
  const errors: string[] = [];

  // Get delivery details
  const { data: delivery, error } = await db
    .from("deliveries")
    .select("*")
    .eq("id", deliveryId)
    .eq("is_active", true)
    .single();

  if (error || !delivery) {
    errors.push("Delivery tidak ditemukan");
    return { valid: false, errors };
  }

  // Check if delivery is in valid status
  if (!["pending", "shipped", "in_transit", "delivered"].includes(delivery.status)) {
    errors.push(`Delivery dengan status ${delivery.status} tidak dapat diterima`);
  }

  // One delivery / surat jalan should produce one GRN. Additional arrivals should use a new delivery.
  const { data: existingGrn } = await db
    .from("grn")
    .select("id, nomor_grn, status")
    .eq("delivery_id", deliveryId)
    .eq("is_active", true)
    .maybeSingle();

  if (existingGrn) {
    errors.push(
      `Delivery ini sudah memiliki dokumen Barang Masuk (${existingGrn.nomor_grn || existingGrn.id}). Buat delivery baru jika ada pengiriman susulan.`
    );
  }

  // Get PO items for reference — gunakan admin DB client (bypass RLS)
  const { data: poItems, error: poItemsError } = await db
    .from("purchase_order_items")
    .select(`
      id,
      raw_material_id,
      product_id,
      qty_ordered,
      qty_received,
      harga_satuan
    `)
    .eq("purchase_order_id", delivery.purchase_order_id)
    .eq("is_active", true);

  if (poItemsError) {
    errors.push(poItemsError.message);
  }

  return {
    valid: errors.length === 0,
    errors,
    delivery: delivery as DeliveryForGrn,
    items: (poItems || []) as POItemForGrn[],
  };
}

// ============================================================
// Calculate GRN totals
// ============================================================

export function calculateGrnTotals(items: { qty_diterima: number; qty_ditolak: number }[]) {
  return items.reduce(
    (acc, item) => ({
      total_diterima: acc.total_diterima + (item.qty_diterima || 0),
      total_ditolak: acc.total_ditolak + (item.qty_ditolak || 0),
    }),
    { total_diterima: 0, total_ditolak: 0 }
  );
}

// ============================================================
// Update PO item received quantities
// ============================================================

export async function updatePOItemReceivedQty(
  db: DbClient,
  poItemId: string,
  qtyReceived: number
): Promise<void> {
  const { error } = await db
    .from("purchase_order_items")
    .update({ qty_received: qtyReceived })
    .eq("id", poItemId);

  if (error) throw error;
}

/**
 * Qty that counts toward PO fulfillment for one GRN line.
 * QC-posted qty wins; pending GRN (awaiting QC) counts 0; otherwise door-accepted qty.
 */
export function resolveGrnItemReceivedQty(params: {
  qty_diterima: number | null | undefined;
  qty_qc_posted?: number | null;
  grn_status: string | null | undefined;
  inventory_posted: boolean;
}): number {
  if (params.inventory_posted) {
    return toQty(params.qty_qc_posted);
  }
  if ((params.grn_status || "").toLowerCase() === "pending") {
    return 0;
  }
  return toQty(params.qty_diterima);
}

/**
 * Idempotent: set each PO item qty_received from active GRN lines
 * (QC accepted when posted, else qty_diterima for finalized non-QC receives).
 */
export async function recalculatePoReceivedQty(
  db: DbClient,
  poId: string
): Promise<void> {
  const { data: poItems, error: poItemsError } = await db
    .from("purchase_order_items")
    .select("id")
    .eq("purchase_order_id", poId)
    .eq("is_active", true);

  if (poItemsError) throw poItemsError;
  if (!poItems?.length) return;

  const { data: grns, error: grnError } = await db
    .from("grn")
    .select("id, status")
    .eq("purchase_order_id", poId)
    .eq("is_active", true);

  if (grnError) throw grnError;

  const receivedByPoItem = new Map<string, number>();
  for (const item of poItems) {
    receivedByPoItem.set(item.id as string, 0);
  }

  if (grns?.length) {
    type GrnRow = { id: string; status: string | null };
    type GrnItemRow = {
      purchase_order_item_id: string | null;
      qty_diterima: number | null;
      qty_qc_posted: number | null;
      grn_id: string;
    };

    const typedGrns = grns as GrnRow[];
    const grnIds = typedGrns.map((g: GrnRow) => g.id);
    const grnStatusById = new Map(
      typedGrns.map((g: GrnRow) => [g.id, g.status ?? ""])
    );

    const { data: inspections, error: qcError } = await db
      .from("grn_qc_inspections")
      .select("grn_id, inventory_posted")
      .in("grn_id", grnIds);

    if (qcError) throw qcError;

    const postedByGrn = new Map<string, boolean>();
    for (const row of inspections || []) {
      if (row.grn_id && row.inventory_posted) {
        postedByGrn.set(row.grn_id as string, true);
      }
    }

    const { data: grnItems, error: itemsError } = await db
      .from("grn_items")
      .select("purchase_order_item_id, qty_diterima, qty_qc_posted, grn_id")
      .in("grn_id", grnIds)
      .eq("is_active", true);

    if (itemsError) throw itemsError;

    for (const line of (grnItems || []) as GrnItemRow[]) {
      const poItemId = line.purchase_order_item_id;
      if (!poItemId || !receivedByPoItem.has(poItemId)) continue;

      const credited = resolveGrnItemReceivedQty({
        qty_diterima: line.qty_diterima,
        qty_qc_posted: line.qty_qc_posted,
        grn_status: grnStatusById.get(line.grn_id) ?? "",
        inventory_posted: postedByGrn.get(line.grn_id) === true,
      });

      receivedByPoItem.set(poItemId, (receivedByPoItem.get(poItemId) || 0) + credited);
    }
  }

  for (const [poItemId, qty] of receivedByPoItem) {
    await updatePOItemReceivedQty(db, poItemId, qty);
  }
}

// ============================================================
// Update Delivery status after GRN
// ============================================================

/**
 * One surat jalan / delivery → one GRN. After GRN is recorded, close the delivery
 * so remaining PO qty can use a new shipment ("Kirim Ulang").
 * Do not keep partial GRN deliveries as in_transit — that blocks re-shipment.
 */
export async function updateDeliveryStatusAfterGrn(
  db: DbClient,
  deliveryId: string,
  grnStatus: GrnStatus
): Promise<void> {
  let newStatus: string;

  switch (grnStatus) {
    case "received":
    case "partially_received":
      newStatus = "delivered";
      break;
    case "rejected":
      newStatus = "cancelled";
      break;
    default:
      return;
  }

  const { error } = await db
    .from("deliveries")
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq("id", deliveryId);

  if (error) throw error;
}

// ============================================================
// Update PO status based on received quantities
// ============================================================

export async function updatePOStatusAfterGrn(
  db: DbClient,
  poId: string
): Promise<void> {
  await recalculatePoReceivedQty(db, poId);

  const { data: po, error: poError } = await db
    .from("purchase_orders")
    .select("id, status")
    .eq("id", poId)
    .maybeSingle();

  if (poError) throw poError;
  // Do not reopen a closed or cancelled PO from GRN activity.
  const current = (po?.status || "").toLowerCase();
  if (current === "closed" || current === "cancelled") {
    return;
  }

  const { data: poItems, error: itemsError } = await db
    .from("purchase_order_items")
    .select("qty_ordered, qty_received")
    .eq("purchase_order_id", poId)
    .eq("is_active", true);

  if (itemsError) throw itemsError;

  if (!poItems || poItems.length === 0) return;

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

  let newStatus: string;
  if (totalReceived === 0) {
    newStatus = "sent";
  } else if (totalReceived >= totalOrdered) {
    newStatus = "received";
  } else {
    newStatus = "partially_received";
  }

  const { error } = await db
    .from("purchase_orders")
    .update({
      status: newStatus,
      updated_at: new Date().toISOString(),
    })
    .eq("id", poId);

  if (error) throw error;
}
