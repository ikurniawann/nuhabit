/** Baca GRN: daftar ber-scope (GET /grn) dan detail (GET /grn/[id]). */
import { ApiError } from "@/lib/api/auth";
import { branchScopeOr, companyScopeOr, getApiUserScope } from "@/lib/api/scope";
import type { DbClient } from "@/lib/pg/types";
import type { GrnListQuery } from "@/lib/purchasing/grn-schemas";
import { selectByIds, uniqueIds } from "@/lib/purchasing/receiving-query";

type GrnRow = {
  id: string;
  nomor_grn: string;
  delivery_id: string | null;
  purchase_order_id: string | null;
  supplier_id: string | null;
  tanggal_penerimaan: string | null;
  no_surat_jalan: string | null;
  status: string;
  total_item_diterima: number | null;
  total_item_ditolak: number | null;
  receive_count: number | null;
  catatan: string | null;
  created_at: string;
};

export type GrnLookups = {
  deliveryNumberById: Map<string, string | null>;
  poNumberById: Map<string, string | null>;
  supplierNameById: Map<string, string | null>;
};

/** Baris daftar GRN; nomor delivery/PO jatuh ke id-nya bila referensi tidak ketemu. */
export function mapGrnListRow(row: GrnRow, lookups: GrnLookups) {
  return {
    id: row.id,
    nomor_grn: row.nomor_grn,
    delivery_id: row.delivery_id,
    delivery_number: (row.delivery_id && lookups.deliveryNumberById.get(row.delivery_id)) || row.delivery_id,
    po_id: row.purchase_order_id,
    po_number:
      (row.purchase_order_id && lookups.poNumberById.get(row.purchase_order_id)) || row.purchase_order_id,
    supplier_id: row.supplier_id,
    supplier_name: (row.supplier_id && lookups.supplierNameById.get(row.supplier_id)) || "—",
    tanggal_penerimaan: row.tanggal_penerimaan,
    no_surat_jalan: row.no_surat_jalan,
    status: row.status,
    total_item_diterima: row.total_item_diterima,
    total_item_ditolak: row.total_item_ditolak,
    receive_count: row.receive_count || 1,
    catatan: row.catatan,
    created_at: row.created_at,
  };
}

export async function listGrns(db: DbClient, params: GrnListQuery) {
  const { page, limit, search, status, delivery_id, po_id, date_from, date_to } = params;
  const offset = (page - 1) * limit;

  let query = db
    .from("grn")
    .select("*", { count: "exact" })
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  const scope = await getApiUserScope();
  const companyOr = companyScopeOr(scope);
  if (companyOr) query = query.or(companyOr);
  const branchOr = branchScopeOr(scope);
  if (branchOr) query = query.or(branchOr);

  if (status) query = query.eq("status", status);
  if (delivery_id) query = query.eq("delivery_id", delivery_id);
  if (po_id) query = query.eq("purchase_order_id", po_id);
  if (date_from) query = query.gte("tanggal_penerimaan", date_from);
  if (date_to) query = query.lte("tanggal_penerimaan", date_to);
  if (search) {
    query = query.or(`nomor_grn.ilike.%${search}%,no_surat_jalan.ilike.%${search}%`);
  }

  const { data, error, count } = await query;
  if (error) throw error;
  const rows = (data || []) as GrnRow[];

  type Ref = Record<string, string | null> & { id: string };
  const [deliveries, purchaseOrders, suppliers] = await Promise.all([
    selectByIds<Ref>(db, "deliveries", "id, nomor_resi, no_resi", uniqueIds(rows.map((row) => row.delivery_id))),
    selectByIds<Ref>(db, "purchase_orders", "id, nomor_po", uniqueIds(rows.map((row) => row.purchase_order_id))),
    selectByIds<Ref>(db, "suppliers", "id, nama_supplier", uniqueIds(rows.map((row) => row.supplier_id))),
  ]);
  const lookups: GrnLookups = {
    deliveryNumberById: new Map(deliveries.map((d) => [d.id, d.no_resi || d.nomor_resi])),
    poNumberById: new Map(purchaseOrders.map((po) => [po.id, po.nomor_po])),
    supplierNameById: new Map(suppliers.map((sup) => [sup.id, sup.nama_supplier])),
  };

  return {
    data: rows.map((row) => mapGrnListRow(row, lookups)),
    total: count || 0,
  };
}

const GRN_ITEM_DETAIL_SELECT = `
  id,
  grn_id,
  delivery_id,
  purchase_order_item_id,
  raw_material_id,
  pos_sku_id,
  qty_diterima,
  qty_ditolak,
  kondisi,
  catatan,
  satuan_id,
  batch_number,
  expiry_date,
  is_active,
  created_at,
  updated_at,
  raw_material:raw_materials!raw_material_id(
    id,
    nama,
    kode,
    satuan_besar:units!satuan_besar_id(id, nama, kode)
  ),
  satuan:units!satuan_id(id, nama, kode),
  pos_sku:pos_product_skus!pos_sku_id(id, sku, name),
  purchase_order_item:purchase_order_items!purchase_order_item_id(
    id,
    qty_ordered,
    qty_received,
    harga_satuan,
    subtotal,
    satuan:units!satuan_id(id, nama, kode)
  )
`;

export async function getGrnDetail(db: DbClient, id: string) {
  const { data: grn, error: grnError } = await db
    .from("grn")
    .select("*")
    .eq("id", id)
    .eq("is_active", true)
    .single();

  if (grnError || !grn) throw ApiError.notFound("GRN tidak ditemukan");

  const { data: items, error: itemsError } = await db
    .from("grn_items")
    .select(GRN_ITEM_DETAIL_SELECT)
    .eq("grn_id", id)
    .eq("is_active", true);

  if (itemsError) {
    console.error(`[GRN/${id}] Error fetching items:`, itemsError);
    throw ApiError.server(itemsError.message || "Gagal memuat item penerimaan");
  }

  const [{ data: delivery }, { data: po }, { data: supplier }] = await Promise.all([
    grn.delivery_id
      ? db.from("deliveries").select("*").eq("id", grn.delivery_id).maybeSingle()
      : Promise.resolve({ data: null }),
    db.from("purchase_orders").select("id, nomor_po, status, tanggal_po, total").eq("id", grn.purchase_order_id).maybeSingle(),
    db.from("suppliers").select("id, nama_supplier, kode, email, telepon").eq("id", grn.supplier_id).maybeSingle(),
  ]);

  return {
    ...grn,
    delivery_number: delivery?.no_resi || delivery?.nomor_resi || delivery?.no_surat_jalan,
    delivery,
    purchase_order: po,
    po_number: po?.nomor_po,
    po_status: po?.status,
    supplier_name: supplier?.nama_supplier,
    supplier,
    items: items || [],
  };
}
