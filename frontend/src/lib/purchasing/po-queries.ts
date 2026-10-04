import { ApiError } from "@/lib/api/auth";
import { branchScopeOr, companyScopeOr, type UserScope } from "@/lib/api/scope";
import type { DbClient } from "@/lib/pg/types";
import { findOpenDelivery } from "@/lib/purchasing/delivery";
import { computePoFulfillmentProgress } from "@/lib/purchasing/po-fulfillment-progress";
import { computePoInvoiceAmounts, getPoCreditBreakdown } from "@/lib/purchasing/po-payments";

export type PoDeliveryRow = {
  id: string;
  purchase_order_id?: string;
  nomor_resi: string | null;
  no_surat_jalan: string | null;
  status: string | null;
  created_at: string;
};

type PoListRow = { id: string; pr_id?: string | null; [column: string]: unknown };

/**
 * Info pengiriman aktif untuk satu PO. `deliveries` urut terbaru dulu: nomor
 * diambil dari pengiriman terbuka, kalau tidak ada dari pengiriman terakhir.
 */
export function summarizePoDelivery(deliveries: PoDeliveryRow[]) {
  const open = findOpenDelivery(deliveries);
  const latest = deliveries[0];
  return {
    active_delivery_id: open?.id || null,
    active_delivery_number:
      open?.nomor_resi ||
      open?.no_surat_jalan ||
      latest?.nomor_resi ||
      latest?.no_surat_jalan ||
      null,
    active_delivery_status: open?.status || latest?.status || null,
  };
}

export type PoListParams = {
  search: string | null;
  status: string | null;
  supplierId: string | null;
  vendorId: string | null;
  moduleType: string;
  tanggalMulai: string | null;
  tanggalSampai: string | null;
  includeCancelled: boolean;
  page: number;
  limit: number;
};

export async function listPurchaseOrders(db: DbClient, params: PoListParams, scope: UserScope | null) {
  let query = db.from("v_purchase_orders").select("*", { count: "exact" });

  const companyOr = companyScopeOr(scope);
  if (companyOr) query = query.or(companyOr);
  const branchOr = branchScopeOr(scope);
  if (branchOr) query = query.or(branchOr);

  const usesVendor = params.moduleType === "product" || params.moduleType === "general";
  if (params.search) {
    const partyColumn = usesVendor ? "vendor_name" : "nama_supplier";
    query = query.or(`nomor_po.ilike.%${params.search}%,${partyColumn}.ilike.%${params.search}%`);
  }
  if (params.status) query = query.eq("status", params.status.toLowerCase());
  if (params.supplierId) query = query.eq("supplier_id", params.supplierId);
  if (params.vendorId) query = query.eq("vendor_id", params.vendorId);
  if (usesVendor || params.moduleType === "raw_material") {
    query = query.eq("module_type", params.moduleType);
  }
  if (params.tanggalMulai) query = query.gte("tanggal_po", params.tanggalMulai);
  if (params.tanggalSampai) query = query.lte("tanggal_po", params.tanggalSampai);
  if (!params.includeCancelled) query = query.neq("status", "cancelled");

  const from = (params.page - 1) * params.limit;
  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range(from, from + params.limit - 1);
  if (error) throw error;

  const rows = (data ?? []) as PoListRow[];
  const poIds = rows.map((po) => po.id).filter(Boolean);
  const prIds = Array.from(new Set(rows.map((po) => po.pr_id).filter(Boolean) as string[]));

  const { data: deliveries, error: deliveriesError } = poIds.length
    ? await db
        .from("deliveries")
        .select("id, purchase_order_id, nomor_resi, no_surat_jalan, status, created_at")
        .in("purchase_order_id", poIds)
        .eq("is_active", true)
        .neq("status", "cancelled")
        .order("created_at", { ascending: false })
    : { data: [], error: null };
  if (deliveriesError) throw deliveriesError;

  const { data: purchaseRequests, error: prError } = prIds.length
    ? await db.from("purchase_requests").select("id, pr_number").in("id", prIds)
    : { data: [], error: null };
  if (prError) throw prError;

  const prNumberById = new Map(
    ((purchaseRequests ?? []) as Array<{ id: string; pr_number: string }>).map((pr) => [pr.id, pr.pr_number])
  );
  const deliveriesByPo = new Map<string, PoDeliveryRow[]>();
  for (const delivery of (deliveries ?? []) as PoDeliveryRow[]) {
    const poId = delivery.purchase_order_id as string;
    deliveriesByPo.set(poId, [...(deliveriesByPo.get(poId) ?? []), delivery]);
  }

  const total = count || 0;
  return {
    data: rows.map((po) => ({
      ...po,
      pr_number: po.pr_id ? prNumberById.get(po.pr_id) ?? null : null,
      ...summarizePoDelivery(deliveriesByPo.get(po.id) ?? []),
    })),
    pagination: {
      page: params.page,
      limit: params.limit,
      total,
      total_pages: Math.ceil(total / params.limit),
    },
  };
}

type RawMaterialRelation = {
  satuan_besar_id?: string | null;
  satuan_kecil_id?: string | null;
  satuan_besar?: unknown;
  satuan_kecil?: unknown;
};

type PoDetailItemRow = {
  supply_item_id?: string | null;
  raw_material?: RawMaterialRelation | null;
  supply_item?: unknown;
  [column: string]: unknown;
};

/** Lengkapi item dengan satuan besar/kecil bahan baku dan barang operasional (lookup manual). */
async function enrichPoDetailItems(db: DbClient, items: PoDetailItemRow[]) {
  const unitIds = Array.from(
    new Set(
      items.flatMap((item) =>
        [item.raw_material?.satuan_besar_id, item.raw_material?.satuan_kecil_id].filter(Boolean)
      ) as string[]
    )
  );
  if (unitIds.length > 0) {
    const { data: unitRows } = await db.from("units").select("id, nama, kode").in("id", unitIds);
    const unitMap = new Map(((unitRows ?? []) as Array<{ id: string }>).map((u) => [u.id, u]));
    for (const item of items) {
      const rm = item.raw_material;
      if (!rm) continue;
      rm.satuan_besar = rm.satuan_besar_id ? unitMap.get(rm.satuan_besar_id) ?? null : null;
      rm.satuan_kecil = rm.satuan_kecil_id ? unitMap.get(rm.satuan_kecil_id) ?? null : null;
    }
  }

  // EPIC-026 B3 — barang operasional (scope 'general').
  const supplyItemIds = Array.from(
    new Set(items.map((item) => item.supply_item_id).filter(Boolean) as string[])
  );
  if (supplyItemIds.length > 0) {
    const { data: supplyRows } = await db
      .from("supply_items")
      .select("id, kode, nama, satuan_id, stockable")
      .in("id", supplyItemIds);
    const supplyMap = new Map(((supplyRows ?? []) as Array<{ id: string }>).map((s) => [s.id, s]));
    for (const item of items) {
      item.supply_item = item.supply_item_id ? supplyMap.get(item.supply_item_id) ?? null : null;
    }
  }
}

/** Header PO + item, nilai tagihan bersih, progres fulfillment, dan pengiriman aktif. */
export async function getPurchaseOrderDetail(db: DbClient, id: string) {
  const { data: po, error: poError } = await db
    .from("v_purchase_orders")
    .select("*")
    .eq("id", id)
    .single();
  if (poError) {
    if (poError.code === "PGRST116") throw ApiError.notFound("PO tidak ditemukan");
    throw poError;
  }

  // Query builder hanya mendukung embed satu level; satuan bahan baku di-resolve manual.
  const { data: itemRows, error: itemsError } = await db
    .from("purchase_order_items")
    .select(`
      *,
      raw_material:raw_materials!raw_material_id (*),
      product:products!product_id (id, kode, nama, satuan_id),
      satuan:units!satuan_id (*)
    `)
    .eq("purchase_order_id", id)
    .eq("is_active", true)
    .order("created_at", { ascending: true });
  if (itemsError) throw itemsError;
  const items = (itemRows ?? []) as PoDetailItemRow[];
  await enrichPoDetailItems(db, items);

  const { data: deliveryRows, error: deliveryError } = await db
    .from("deliveries")
    .select("id, nomor_resi, no_surat_jalan, status, created_at")
    .eq("purchase_order_id", id)
    .eq("is_active", true)
    .neq("status", "cancelled")
    .order("created_at", { ascending: false });
  if (deliveryError) throw deliveryError;
  const delivery = summarizePoDelivery((deliveryRows ?? []) as PoDeliveryRow[]);

  const creditBreakdown = await getPoCreditBreakdown(db, id, po.status as string | null);
  const invoice = computePoInvoiceAmounts({
    grossPayable: Number(po.payable_amount ?? po.grand_total ?? po.total ?? 0),
    returnCredit: creditBreakdown.return_credit_amount,
    rejectCredit: creditBreakdown.reject_credit_amount,
    paidAmount: Number(po.paid_amount || 0),
    nextDueDate: po.next_due_date,
  });

  const progress = await computePoFulfillmentProgress(
    db,
    id,
    String(po.status || "draft"),
    Number(po.received_percentage ?? po.receive_percentage ?? po.progress_pct ?? 0)
  );

  return {
    ...po,
    ...invoice,
    order_progress_pct: progress.order_progress_pct,
    qc_progress_pct: progress.qc_progress_pct,
    return_progress_pct: progress.return_progress_pct,
    fulfillment_progress_pct: progress.fulfillment_progress_pct,
    total_qty_received_grn: progress.total_qty_received_grn,
    total_qty_qc_posted: progress.total_qty_qc_posted,
    total_qty_returned: progress.total_qty_returned,
    ...delivery,
    items,
  };
}
