import { z } from "zod";
import { formatNumber } from "@/lib/format";
import type { DbClient } from "@/lib/pg/types";
import { toQty } from "@/lib/purchasing/utils";

type Numeric = number | string | null | undefined;

export const poReportQuerySchema = z.object({
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  vendor_id: z.string().uuid().optional(),
  status: z.string().optional(),
  export: z.enum(["json", "csv"]).default("json"),
});

export type PoReportQuery = z.infer<typeof poReportQuerySchema>;

/** Baris v_purchase_orders; nama kolom alternatif menampung view lama. */
export interface PoViewRow {
  id: string;
  supplier_id?: string | null;
  nomor_po?: string | null;
  po_number?: string | null;
  nama_supplier?: string | null;
  supplier_name?: string | null;
  vendor_name?: string | null;
  supplier_kode?: string | null;
  kode_supplier?: string | null;
  supplier_code?: string | null;
  vendor_code?: string | null;
  status?: string | null;
  tanggal_po?: string | null;
  tanggal_diterima?: string | null;
  total?: Numeric;
  total_amount?: Numeric;
  payable_amount?: Numeric;
  currency?: string | null;
  item_count?: Numeric;
  total_items?: Numeric;
  created_by_name?: string | null;
  created_by?: string | null;
}

export interface PoLineItemRow {
  id?: string | null;
  purchase_order_id: string;
  raw_material_id?: string | null;
  product_id?: string | null;
  qty_ordered?: Numeric;
  qty_order?: Numeric;
  quantity?: Numeric;
  qty_received?: Numeric;
  harga_satuan?: Numeric;
  unit_price?: Numeric;
  subtotal?: Numeric;
  nama_bahan?: string | null;
  nama?: string | null;
  kode_bahan?: string | null;
  kode?: string | null;
  satuan_nama?: string | null;
  raw_material?: { kode?: string | null; nama?: string | null } | null;
  product?: { kode?: string | null; nama?: string | null } | null;
  satuan?: { kode?: string | null; nama?: string | null } | string | null;
}

/** Nominal tanpa "Rp" (format lama kolom *_formatted). */
const formatAmount = (value: number) => formatNumber(value);

export function mapPoHeader(po: PoViewRow) {
  const amount = toQty(po.total ?? po.total_amount ?? po.payable_amount);
  return {
    po_number: po.nomor_po || po.po_number,
    vendor: po.nama_supplier || po.supplier_name || po.vendor_name || "-",
    vendor_code: po.supplier_kode || po.kode_supplier || po.supplier_code || po.vendor_code || "",
    status: String(po.status || "unknown").toLowerCase(),
    tanggal_po: po.tanggal_po,
    tanggal_diterima: po.tanggal_diterima || null,
    total_amount: amount,
    total_amount_formatted: formatAmount(amount),
    mata_uang: po.currency || "IDR",
    created_by: po.created_by_name || po.created_by || "-",
  };
}

export function mapPoLineItem(item: PoLineItemRow) {
  const unit = typeof item.satuan === "object" ? item.satuan : null;
  const qtyOrder = toQty(item.qty_ordered ?? item.qty_order ?? item.quantity);
  const harga = toQty(item.harga_satuan ?? item.unit_price);
  return {
    id: item.id || item.raw_material_id || item.product_id,
    nama_bahan: item.raw_material?.nama || item.product?.nama || item.nama_bahan || item.nama || "-",
    kode_bahan: item.raw_material?.kode || item.product?.kode || item.kode_bahan || item.kode || "",
    qty_order: qtyOrder,
    qty_received: toQty(item.qty_received),
    harga_satuan: harga,
    satuan: unit?.nama || unit?.kode || item.satuan_nama || (typeof item.satuan === "string" ? item.satuan : "") || "",
    subtotal: toQty(item.subtotal) || qtyOrder * harga,
  };
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Rekap jumlah & nilai PO per status (urutan kemunculan) + grand total. */
export function summarizePoByStatus(rows: Array<{ status: string; total_amount: number }>) {
  const byStatus: Record<string, { count: number; total: number }> = {};
  let grandTotal = 0;
  for (const row of rows) {
    grandTotal += row.total_amount;
    if (!byStatus[row.status]) byStatus[row.status] = { count: 0, total: 0 };
    byStatus[row.status].count++;
    byStatus[row.status].total += row.total_amount;
  }
  return {
    by_status: Object.entries(byStatus).map(([status, value]) => ({
      status,
      count: value.count,
      total: round2(value.total),
      total_formatted: formatAmount(value.total),
    })),
    grandTotal,
  };
}

export async function loadPurchaseOrders(db: DbClient, params: PoReportQuery) {
  let query = db.from("v_purchase_orders").select("*").order("tanggal_po", { ascending: false });
  if (params.date_from) query = query.gte("tanggal_po", params.date_from);
  if (params.date_to) query = query.lte("tanggal_po", params.date_to);
  if (params.vendor_id) query = query.eq("supplier_id", params.vendor_id);
  if (params.status) query = query.eq("status", params.status.toLowerCase());

  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as PoViewRow[];
}

// ── PO summary ──────────────────────────────────────────────────────────────

export function buildPoSummary(pos: PoViewRow[]) {
  const summary = pos.map((po) => {
    const { created_by, ...header } = mapPoHeader(po);
    return { ...header, item_count: toQty(po.item_count || po.total_items), created_by };
  });
  const { by_status, grandTotal } = summarizePoByStatus(summary);
  return { summary, by_status, grand_total: round2(grandTotal) };
}

export function poSummaryCsv(summary: ReturnType<typeof buildPoSummary>["summary"]) {
  const header =
    "PO Number,Vendor,Vendor Code,Status,Tanggal PO,Tanggal Diterima,Total Amount,Mata Uang,Item Count,Created By\n";
  const rows = summary
    .map(
      (po) =>
        `${po.po_number},"${po.vendor || ""}",${po.vendor_code || ""},${po.status},${po.tanggal_po || ""},${po.tanggal_diterima || ""},${po.total_amount},${po.mata_uang},${po.item_count},"${po.created_by || ""}"`
    )
    .join("\n");
  return header + rows;
}

// ── PO detail ───────────────────────────────────────────────────────────────

export async function loadPoLineItems(db: DbClient, poIds: string[]) {
  const { data, error } = await db
    .from("purchase_order_items")
    .select(
      `
      id,
      purchase_order_id,
      raw_material_id,
      product_id,
      qty_ordered,
      qty_received,
      harga_satuan,
      subtotal,
      is_active,
      raw_material:raw_materials!raw_material_id (id, kode, nama),
      product:products!product_id (id, kode, nama),
      satuan:units!satuan_id (id, kode, nama)
    `
    )
    .in("purchase_order_id", poIds)
    .eq("is_active", true);
  if (error) throw error;
  return (data || []) as PoLineItemRow[];
}

export function buildPoDetail(pos: PoViewRow[], items: PoLineItemRow[]) {
  const itemsByPoId = new Map<string, ReturnType<typeof mapPoLineItem>[]>();
  for (const item of items) {
    const list = itemsByPoId.get(item.purchase_order_id) || [];
    list.push(mapPoLineItem(item));
    itemsByPoId.set(item.purchase_order_id, list);
  }

  const detailed = pos.map((po) => {
    const poItems = itemsByPoId.get(po.id) || [];
    const { created_by, po_number, ...header } = mapPoHeader(po);
    return {
      id: po.id,
      po_number,
      ...header,
      supplier_id: po.supplier_id,
      item_count: poItems.length,
      created_by,
      items: poItems,
    };
  });
  const { by_status, grandTotal } = summarizePoByStatus(detailed);
  return {
    summary: detailed,
    by_status,
    grand_total: round2(grandTotal),
    grand_total_formatted: formatAmount(grandTotal),
  };
}

const PO_DETAIL_CSV_HEADER = [
  "No PO",
  "Tanggal",
  "Supplier",
  "Supplier Code",
  "Status",
  "Nama Bahan",
  "Kode Bahan",
  "Qty Order",
  "Qty Diterima",
  "Harga Satuan",
  "Subtotal",
  "Total PO",
  "Mata Uang",
  "Created By",
];

/** Satu baris per item; kolom header PO hanya diisi di baris item pertama. */
export function poDetailCsvRows(pos: ReturnType<typeof buildPoDetail>["summary"]) {
  const rows: string[][] = [];
  for (const po of pos) {
    const head = (first: boolean) => [
      first ? po.po_number || "" : "",
      first ? po.tanggal_po || "" : "",
      first ? po.vendor || "" : "",
      first ? po.vendor_code || "" : "",
      first ? po.status : "",
    ];
    const tail = (first: boolean) => [
      first ? String(po.total_amount) : "",
      first ? po.mata_uang : "",
      first ? po.created_by || "" : "",
    ];
    if (po.items.length === 0) {
      rows.push([...head(true), "-", "-", "", "", "", "", ...tail(true)]);
      continue;
    }
    po.items.forEach((item, idx) => {
      rows.push([
        ...head(idx === 0),
        item.nama_bahan,
        item.kode_bahan || "",
        String(item.qty_order),
        String(item.qty_received),
        String(item.harga_satuan),
        String(item.subtotal),
        ...tail(idx === 0),
      ]);
    });
  }
  return { header: PO_DETAIL_CSV_HEADER, rows };
}
