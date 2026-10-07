/** Baris GRN yang masih bisa diretur ke supplier/vendor (GET /grn/[id]/returnable-items). */
import type { DbClient } from "@/lib/pg/types";
import { toQty } from "@/lib/purchasing/utils";

export type ReturnableGrnItemRow = {
  id: string;
  grn_id: string;
  raw_material_id: string | null;
  product_id: string | null;
  qty_diterima: number | string | null;
  qty_returned: number | string | null;
  qty_qc_posted: number | string | null;
  batch_number: string | null;
  expiry_date: string | null;
  qc_status: string | null;
  warehouse_id: string | null;
  raw_material: { kode: string; nama: string } | null;
  product: { kode: string; nama: string } | null;
  grn: {
    supplier_id: string | null;
    vendor_id: string | null;
    supplier: { nama_supplier: string } | null;
    vendor: { name: string } | null;
  };
  purchase_order_item: { harga_satuan: number | string | null } | null;
  satuan: { nama: string | null } | null;
  warehouse: { name: string | null } | null;
};

const RETURNABLE_ITEM_SELECT = `
  id,
  grn_id,
  raw_material_id,
  product_id,
  qty_diterima,
  qty_returned,
  qty_qc_posted,
  batch_number,
  expiry_date,
  qc_status,
  warehouse_id,
  raw_material:raw_materials (kode, nama),
  product:products (kode, nama),
  grn:grn (
    supplier_id,
    vendor_id,
    supplier:suppliers (nama_supplier),
    vendor:vendors (name)
  ),
  purchase_order_item:purchase_order_items (harga_satuan),
  satuan:units (nama),
  warehouse:warehouses (name)
`;

/**
 * Qty tersedia = qty QC diposting − sudah diretur (+ qty retur yang sedang
 * diedit, supaya baris itu tidak memblokir dirinya sendiri). Hanya yang > 0.
 */
export function mapReturnableItems(
  rows: ReturnableGrnItemRow[],
  giveBackByGrnItem: Map<string, number>
) {
  return rows
    .map((item) => ({
      grn_item_id: item.id,
      grn_id: item.grn_id,
      raw_material_id: item.raw_material_id || "",
      product_id: item.product_id || undefined,
      raw_material_kode: item.raw_material?.kode || item.product?.kode || "",
      raw_material_nama: item.raw_material?.nama || item.product?.nama || "",
      product_kode: item.product?.kode,
      product_nama: item.product?.nama,
      qty_diterima: toQty(item.qty_diterima),
      qty_returned: toQty(item.qty_returned),
      qty_available_to_return: Math.max(
        0,
        toQty(item.qty_qc_posted) - toQty(item.qty_returned) + (giveBackByGrnItem.get(item.id) || 0)
      ),
      unit_price: toQty(item.purchase_order_item?.harga_satuan),
      batch_number: item.batch_number,
      expiry_date: item.expiry_date,
      qc_status: item.qc_status,
      supplier_id: item.grn.supplier_id || item.grn.vendor_id || "",
      vendor_id: item.grn.vendor_id || undefined,
      nama_supplier: item.grn.supplier?.nama_supplier || item.grn.vendor?.name || "",
      satuan: item.satuan?.nama || undefined,
      warehouse_id: item.warehouse_id,
      warehouse_name: item.warehouse?.name || undefined,
    }))
    .filter((item) => item.qty_available_to_return > 0);
}

export async function listReturnableGrnItems(
  db: DbClient,
  grnId: string,
  excludeReturnId: string | null
) {
  const { data: qc, error: qcError } = await db
    .from("grn_qc_inspections")
    .select("id, inventory_posted")
    .eq("grn_id", grnId)
    .maybeSingle();
  if (qcError) throw qcError;
  if (!qc?.inventory_posted) return [];

  const giveBackByGrnItem = new Map<string, number>();
  if (excludeReturnId) {
    const { data: lines, error } = await db
      .from("purchase_return_items")
      .select("grn_item_id, qty_returned")
      .eq("return_id", excludeReturnId);
    if (error) throw error;

    for (const line of (lines || []) as { grn_item_id: string | null; qty_returned: unknown }[]) {
      if (!line.grn_item_id) continue;
      giveBackByGrnItem.set(
        line.grn_item_id,
        (giveBackByGrnItem.get(line.grn_item_id) || 0) + toQty(line.qty_returned)
      );
    }
  }

  const { data: items, error } = await db
    .from("grn_items")
    .select(RETURNABLE_ITEM_SELECT)
    .eq("grn_id", grnId)
    .eq("is_active", true);
  if (error) throw error;

  return mapReturnableItems((items || []) as ReturnableGrnItemRow[], giveBackByGrnItem);
}
