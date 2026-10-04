/** Pemetaan murni baris delivery untuk route /api/purchasing/delivery/**. */
import { findOpenDelivery, isPoEligibleForNewDelivery } from "@/lib/purchasing/delivery";
import type { UpdateDeliveryInput } from "@/lib/purchasing/delivery-schemas";
import type { PurchasingModuleType } from "@/lib/purchasing/module-scope";

export type DeliveryRow = {
  id: string;
  purchase_order_id: string;
  supplier_id?: string | null;
  vendor_id?: string | null;
  nomor_resi?: string | null;
  no_resi?: string | null;
  no_surat_jalan?: string | null;
  kurir?: string | null;
  status?: string | null;
  tanggal_kirim?: string | null;
  tanggal_estimasi_tiba?: string | null;
  tanggal_aktual_tiba?: string | null;
  created_at?: string | null;
  company_id?: string | null;
  branch_id?: string | null;
  [key: string]: unknown;
};

export type PoOptionRow = {
  id: string;
  nomor_po: string | null;
  supplier_id: string | null;
  vendor_id: string | null;
  status: string | null;
  company_id: string | null;
  branch_id: string | null;
};

export type PartyRow = {
  id: string;
  name: string | null;
  company_id?: string | null;
  branch_id?: string | null;
};

/** Baris daftar delivery (GET /delivery). */
export function mapDeliveryListRow(row: DeliveryRow, poNumberById: Map<string, string>) {
  return {
    id: row.id,
    delivery_number: row.nomor_resi || row.no_resi || "-",
    po_id: row.purchase_order_id,
    po_number: poNumberById.get(row.purchase_order_id) || "-",
    no_surat_jalan: row.no_surat_jalan || "-",
    ekspedisi: row.kurir || "-",
    no_resi: row.no_resi || row.nomor_resi || "-",
    tanggal_kirim: row.tanggal_kirim,
    tanggal_estimasi_tiba: row.tanggal_estimasi_tiba,
    tanggal_aktual_tiba: row.tanggal_aktual_tiba,
    status: row.status,
    created_at: row.created_at,
  };
}

/** Kolom yang diubah PUT /delivery/[id]; `ekspedisi` disimpan di kolom `kurir`. */
export function buildDeliveryUpdate(input: UpdateDeliveryInput, userId: string): Record<string, unknown> {
  const update: Record<string, unknown> = { updated_by: userId };
  if (input.no_surat_jalan) update.no_surat_jalan = input.no_surat_jalan;
  if (input.ekspedisi !== undefined) update.kurir = input.ekspedisi;
  if (input.no_resi !== undefined) update.no_resi = input.no_resi;
  if (input.tanggal_kirim) update.tanggal_kirim = input.tanggal_kirim;
  if (input.tanggal_estimasi_tiba) update.tanggal_estimasi_tiba = input.tanggal_estimasi_tiba;
  if (input.tanggal_aktual_tiba) update.tanggal_aktual_tiba = input.tanggal_aktual_tiba;
  if (input.status) update.status = input.status;
  if (input.catatan !== undefined) update.catatan = input.catatan;
  return update;
}

/** Ringkasan supplier/vendor/PO untuk detail delivery. */
export function summarizeDeliveryRefs(refs: {
  supplier: Record<string, unknown> | null;
  vendor: Record<string, unknown> | null;
  purchaseOrder: Record<string, unknown> | null;
}) {
  const { supplier, vendor, purchaseOrder } = refs;
  return {
    supplier: supplier
      ? {
          id: supplier.id,
          nama: supplier.nama_supplier || supplier.nama || "-",
          kode: supplier.kode_supplier || supplier.kode || "",
        }
      : null,
    vendor: vendor ? { id: vendor.id, nama: vendor.name || "-", kode: vendor.code || "" } : null,
    purchase_order: purchaseOrder
      ? {
          id: purchaseOrder.id,
          po_number: purchaseOrder.nomor_po || purchaseOrder.po_number || "-",
          status: purchaseOrder.status || "",
        }
      : null,
  };
}

/** company/branch efektif PO: milik PO, lalu supplier, lalu vendor. */
export function poBusinessScope(
  po: PoOptionRow,
  supplier: PartyRow | null | undefined,
  vendor: PartyRow | null | undefined
): { company_id: string | null; branch_id: string | null } {
  return {
    company_id: po.company_id ?? supplier?.company_id ?? vendor?.company_id ?? null,
    branch_id: po.branch_id ?? supplier?.branch_id ?? vendor?.branch_id ?? null,
  };
}

/**
 * Opsi PO untuk form delivery: info delivery terbuka/terakhir per PO. Tanpa
 * `includeAssigned`, PO yang masih punya delivery terbuka disaring.
 */
export function mapPoOptions(params: {
  orders: PoOptionRow[];
  deliveriesByPoId: Map<string, DeliveryRow[]>;
  supplierNameById: Map<string, string | null>;
  vendorNameById: Map<string, string | null>;
  moduleType: PurchasingModuleType;
  includeAssigned: boolean;
}) {
  const { orders, deliveriesByPoId, supplierNameById, vendorNameById, moduleType } = params;
  return orders
    .map((po) => {
      const poDeliveries = deliveriesByPoId.get(po.id) || [];
      const openDelivery = findOpenDelivery(poDeliveries);
      const latestDelivery = poDeliveries[0] ?? null;
      const partyName =
        moduleType === "product"
          ? po.vendor_id && vendorNameById.get(po.vendor_id)
          : po.supplier_id && supplierNameById.get(po.supplier_id);

      return {
        id: po.id,
        nomor_po: po.nomor_po,
        supplier_id: po.supplier_id,
        vendor_id: po.vendor_id,
        nama_supplier: partyName ?? null,
        status: po.status,
        active_delivery_id: openDelivery?.id ?? null,
        active_delivery_number:
          openDelivery?.nomor_resi ||
          openDelivery?.no_surat_jalan ||
          latestDelivery?.nomor_resi ||
          latestDelivery?.no_surat_jalan ||
          null,
        active_delivery_status: openDelivery?.status ?? latestDelivery?.status ?? null,
        has_open_delivery: Boolean(openDelivery),
      };
    })
    .filter(
      (po) =>
        params.includeAssigned ||
        isPoEligibleForNewDelivery(
          po.status,
          (deliveriesByPoId.get(po.id) || []).map((delivery) => ({
            id: delivery.id,
            status: delivery.status,
          }))
        )
    );
}

/** Delivery siap diterima (GET /delivery/for-grn): nama pihak & nomor PO/delivery. */
export function mapDeliveryForGrn(
  delivery: DeliveryRow,
  lookups: {
    supplierNameById: Map<string, string>;
    vendorNameById: Map<string, string>;
    poNumberById: Map<string, string>;
  }
) {
  const vendorName = delivery.vendor_id ? lookups.vendorNameById.get(delivery.vendor_id) : null;
  return {
    ...delivery,
    po_id: delivery.purchase_order_id,
    supplier_name:
      (delivery.supplier_id ? lookups.supplierNameById.get(delivery.supplier_id) : null) ||
      vendorName ||
      delivery.kurir ||
      "-",
    vendor_name: delivery.vendor_id ? vendorName || null : null,
    po_number: lookups.poNumberById.get(delivery.purchase_order_id) || "-",
    delivery_number:
      delivery.nomor_resi || delivery.no_resi || delivery.no_surat_jalan || delivery.id,
  };
}
