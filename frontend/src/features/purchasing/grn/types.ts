import type { ContinueGrnApiItem, PosSkuRef } from "@/lib/purchasing/grn-ui-lines";

export type { ReceivingWorkspaceData } from "@/lib/purchasing/receiving-ui-workspace";

export type GrnStatus = "pending" | "partially_received" | "received" | "rejected";

export interface GrnListRow {
  id: string;
  nomor_grn: string;
  delivery_id: string;
  delivery_number: string;
  po_id: string;
  po_number: string;
  supplier_name: string;
  no_surat_jalan: string;
  tanggal_penerimaan: string;
  status: GrnStatus;
  total_item_diterima: number;
  total_item_ditolak: number;
  created_at: string;
}

export interface GrnListParams {
  page?: number;
  limit?: number;
  search?: string;
}

export interface GrnListResult {
  data: GrnListRow[];
  total: number;
}

export type VendorCreditRow = {
  id: string;
  credit_number: string;
  source_type: "receive_reject" | "qc_reject";
  status: string;
  total_amount: number;
  reason_notes?: string | null;
  items?: {
    id: string;
    qty: number;
    unit_price: number;
    line_amount: number;
    raw_material?: { kode?: string; nama?: string };
  }[];
};

type UnitRef = { nama?: string | null; kode?: string | null } | null;

/** Item GRN dari GET /api/purchasing/grn/[id] (dipakai detail, QC dan lanjutkan GRN). */
export type GrnDetailItem = ContinueGrnApiItem & {
  product_id?: string | null;
  qc_status?: string | null;
  raw_material?: {
    nama?: string | null;
    nama_bahan?: string | null;
    kode?: string | null;
    satuan_besar?: UnitRef;
  } | null;
  product?: { nama?: string | null; kode?: string | null } | null;
  satuan?: UnitRef;
  purchase_order_item?: (NonNullable<ContinueGrnApiItem["purchase_order_item"]> & {
    harga_satuan?: number | null;
    satuan?: UnitRef;
    pos_sku?: PosSkuRef | null;
  }) | null;
  catatan?: string | null;
  batch_number?: string | null;
  expiry_date?: string | null;
};

export type GrnDetail = {
  id: string;
  nomor_grn?: string | null;
  status?: string | null;
  po_id?: string | null;
  po_number?: string | null;
  purchase_order_id?: string | null;
  tanggal_penerimaan?: string | null;
  supplier_name?: string | null;
  no_surat_jalan?: string | null;
  total_item_diterima?: number | null;
  total_item_ditolak?: number | null;
  delivery_id?: string | null;
  delivery_number?: string | null;
  catatan?: string | null;
  supplier?: {
    nama_supplier?: string | null;
    kode?: string | null;
    email?: string | null;
    telepon?: string | null;
  } | null;
  purchase_order?: {
    id?: string | null;
    nomor_po?: string | null;
    status?: string | null;
    tanggal_po?: string | null;
    total?: number | null;
  } | null;
  delivery?: {
    nomor_resi?: string | null;
    no_surat_jalan?: string | null;
    kurir?: string | null;
    status?: string | null;
    tanggal_kirim?: string | null;
    tanggal_estimasi_tiba?: string | null;
    tanggal_aktual_tiba?: string | null;
  } | null;
  items?: GrnDetailItem[];
};

/** QC GRN dari GET /api/purchasing/grn/[id]/qc. */
export type GrnQcInspection = {
  id?: string;
  status?: string | null;
  hasil?: string | null;
  inventory_posted?: boolean | null;
  inspected_at?: string | null;
  tanggal_inspeksi?: string | null;
  catatan_qc?: string | null;
  catatan?: string | null;
  inspected_by_user?: { email?: string | null } | null;
  inspector?: { email?: string | null; name?: string | null } | null;
};
