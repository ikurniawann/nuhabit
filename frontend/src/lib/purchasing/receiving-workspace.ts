/** Data halaman workspace penerimaan (GET /api/purchasing/receiving-workspace). */
import type { DbClient } from "@/lib/pg/types";
import { getPurchaseOrderIdsByModuleType, type PurchasingModuleType } from "@/lib/purchasing/module-scope";
import { selectByIds, uniqueIds } from "@/lib/purchasing/receiving-query";

export type WorkspaceDeliveryRow = {
  id: string;
  purchase_order_id: string;
  supplier_id: string | null;
  vendor_id: string | null;
  nomor_resi: string | null;
  no_resi: string | null;
  no_surat_jalan: string | null;
  kurir: string | null;
  tanggal_kirim: string | null;
  tanggal_estimasi_tiba: string | null;
  tanggal_aktual_tiba: string | null;
  status: string | null;
  created_at: string | null;
};

export type WorkspaceGrnRow = {
  id: string;
  nomor_grn: string;
  delivery_id: string;
  purchase_order_id: string;
  supplier_id: string | null;
  vendor_id: string | null;
  tanggal_penerimaan: string | null;
  no_surat_jalan: string | null;
  status: string;
  total_item_diterima: number | null;
  total_item_ditolak: number | null;
  receive_count: number | null;
  catatan: string | null;
  created_at: string | null;
};

export type WorkspacePoRow = { id: string; [key: string]: unknown };

type Lookups = {
  poNumberById: Map<string, string>;
  supplierNameById: Map<string, string>;
  vendorNameById: Map<string, string>;
};

function partyName(
  row: { supplier_id: string | null; vendor_id: string | null },
  lookups: Lookups
): string | null {
  return (
    (row.supplier_id ? lookups.supplierNameById.get(row.supplier_id) : null) ||
    (row.vendor_id ? lookups.vendorNameById.get(row.vendor_id) : null) ||
    null
  );
}

/** Saring ke PO ber-modul ini dan kumpulkan id yang perlu dicari namanya. */
export function scopeWorkspaceRows(
  rows: { purchaseOrders: WorkspacePoRow[]; deliveries: WorkspaceDeliveryRow[]; grns: WorkspaceGrnRow[] },
  scopedPoIds: Set<string>
) {
  const deliveries = rows.deliveries.filter((d) => scopedPoIds.has(d.purchase_order_id));
  const grns = rows.grns.filter((g) => scopedPoIds.has(g.purchase_order_id));
  const deliveryPoIds = new Set(deliveries.map((d) => d.purchase_order_id).filter(Boolean));
  const parties = [...deliveries, ...grns];

  return {
    deliveries,
    grns,
    purchaseOrders: rows.purchaseOrders.filter((po) => deliveryPoIds.has(po.id)),
    poIds: Array.from(deliveryPoIds),
    supplierIds: uniqueIds(parties.map((row) => row.supplier_id)),
    vendorIds: uniqueIds(parties.map((row) => row.vendor_id)),
  };
}

export function mapWorkspaceDeliveries(deliveries: WorkspaceDeliveryRow[], lookups: Lookups) {
  return deliveries.map((delivery) => ({
    id: delivery.id,
    po_id: delivery.purchase_order_id,
    po_number: lookups.poNumberById.get(delivery.purchase_order_id) || delivery.purchase_order_id,
    supplier_name: partyName(delivery, lookups),
    delivery_number: delivery.nomor_resi,
    no_surat_jalan: delivery.no_surat_jalan,
    ekspedisi: delivery.kurir,
    no_resi: delivery.no_resi || delivery.nomor_resi,
    tanggal_kirim: delivery.tanggal_kirim,
    tanggal_estimasi_tiba: delivery.tanggal_estimasi_tiba,
    tanggal_aktual_tiba: delivery.tanggal_aktual_tiba,
    status: delivery.status,
    created_at: delivery.created_at,
  }));
}

export function mapWorkspaceGrns(
  grns: WorkspaceGrnRow[],
  deliveries: ReturnType<typeof mapWorkspaceDeliveries>,
  lookups: Lookups
) {
  const deliveryNumberById = new Map(
    deliveries.map((d) => [d.id, d.no_resi || d.delivery_number || d.po_number])
  );
  return grns.map((grn) => ({
    id: grn.id,
    nomor_grn: grn.nomor_grn,
    delivery_id: grn.delivery_id,
    delivery_number: deliveryNumberById.get(grn.delivery_id) || grn.delivery_id,
    po_id: grn.purchase_order_id,
    po_number: lookups.poNumberById.get(grn.purchase_order_id) || grn.purchase_order_id,
    supplier_id: grn.supplier_id,
    supplier_name: partyName(grn, lookups),
    tanggal_penerimaan: grn.tanggal_penerimaan,
    no_surat_jalan: grn.no_surat_jalan,
    status: grn.status,
    total_item_diterima: grn.total_item_diterima,
    total_item_ditolak: grn.total_item_ditolak,
    receive_count: grn.receive_count || 1,
    catatan: grn.catatan,
    created_at: grn.created_at,
  }));
}

export async function loadReceivingWorkspace(db: DbClient, moduleType: PurchasingModuleType) {
  const scopedPoIds = new Set(await getPurchaseOrderIdsByModuleType(db, moduleType));

  const recent = (table: string) =>
    db.from(table).select("*").eq("is_active", true).order("created_at", { ascending: false }).limit(200);
  const [poResult, deliveryResult, grnResult] = await Promise.all([
    db
      .from("v_purchase_orders")
      .select("*")
      .eq("module_type", moduleType)
      .order("created_at", { ascending: false })
      .limit(200),
    recent("deliveries"),
    recent("grn"),
  ]);
  if (poResult.error) throw poResult.error;
  if (deliveryResult.error) throw deliveryResult.error;
  if (grnResult.error) throw grnResult.error;

  const scoped = scopeWorkspaceRows(
    {
      purchaseOrders: (poResult.data || []) as WorkspacePoRow[],
      deliveries: (deliveryResult.data || []) as WorkspaceDeliveryRow[],
      grns: (grnResult.data || []) as WorkspaceGrnRow[],
    },
    scopedPoIds
  );

  const [purchaseOrders, suppliers, vendors] = await Promise.all([
    selectByIds<{ id: string; nomor_po: string }>(db, "purchase_orders", "id, nomor_po", scoped.poIds),
    selectByIds<{ id: string; nama_supplier: string }>(db, "suppliers", "id, nama_supplier", scoped.supplierIds),
    selectByIds<{ id: string; name: string }>(db, "vendors", "id, name", scoped.vendorIds),
  ]);
  const poNumberById = new Map(purchaseOrders.map((po) => [po.id, po.nomor_po]));
  const supplierNameById = new Map(suppliers.map((sup) => [sup.id, sup.nama_supplier]));
  const vendorNameById = new Map(vendors.map((vendor) => [vendor.id, vendor.name]));
  const lookups = { poNumberById, supplierNameById, vendorNameById };
  const deliveries = mapWorkspaceDeliveries(scoped.deliveries, lookups);

  return {
    purchase_orders: scoped.purchaseOrders,
    deliveries,
    grns: mapWorkspaceGrns(scoped.grns, deliveries, lookups),
  };
}
