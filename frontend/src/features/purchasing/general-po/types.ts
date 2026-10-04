// EPIC-026 B3b — tipe PO barang operasional (scope 'general'). Klon product-po:
// pemasok REUSE `vendors`, diskriminan item = `supply_item_id`, sumber item form
// = `supplies` (item.supply_items) tanpa vendor price list.

export type GeneralPOStatus =
  | "draft"
  | "approved"
  | "sent"
  | "partially_received"
  | "partial"
  | "received"
  | "cancelled";

export interface GeneralPOListParams {
  page?: number;
  limit?: number;
  status?: string;
  search?: string;
}

export interface GeneralPOListItem {
  id: string;
  nomor_po: string;
  tanggal_po: string;
  tanggal_kirim_estimasi?: string | null;
  vendor_id?: string | null;
  vendor_name?: string | null;
  vendor_code?: string | null;
  status: string;
  subtotal?: number;
  diskon_persen?: number;
  diskon_nominal?: number;
  ppn_persen?: number;
  ppn_nominal?: number;
  total?: number;
  grand_total?: number;
  pr_id?: string | null;
  pr_number?: string | null;
  total_items?: number;
  progress_pct?: number;
  module_type?: string;
  created_at?: string;
}

export interface GeneralPOListResult {
  data: GeneralPOListItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}

export interface GeneralPOItemFormInput {
  supply_item_id: string;
  pr_item_id?: string;
  satuan_id?: string;
  qty_ordered: number;
  harga_satuan: number;
  notes?: string;
}

export interface GeneralPOFormInput {
  vendor_id: string;
  pr_id?: string;
  tanggal_po: string;
  tanggal_kirim_estimasi?: string;
  catatan?: string;
  alamat_pengiriman?: string;
  diskon_persen: number;
  diskon_nominal: number;
  ppn_persen: number;
  items: GeneralPOItemFormInput[];
}

export interface GeneralPOFormPayload extends GeneralPOFormInput {
  module_type?: "general";
}

export interface GeneralPOFormSupply {
  id: string;
  kode: string;
  nama: string;
  satuan_id?: string | null;
  stockable?: boolean;
  harga_beli?: number | null;
}

export interface GeneralPOFormVendor {
  id: string;
  code: string;
  name: string;
}

export interface GeneralPOFormData {
  vendors: GeneralPOFormVendor[];
  supplies: GeneralPOFormSupply[];
  units: { id: string; nama: string; kode?: string }[];
}

export interface GeneralPODetailItem {
  id: string;
  supply_item_id?: string | null;
  satuan_id?: string | null;
  qty_ordered?: number | null;
  qty_received?: number | null;
  harga_satuan?: number | null;
  subtotal?: number | null;
  catatan?: string | null;
  supply_item?: { id: string; kode: string; nama: string; stockable?: boolean } | null;
  satuan?: { id: string; nama: string } | null;
}

export interface GeneralPODetail extends GeneralPOListItem {
  catatan?: string | null;
  alamat_pengiriman?: string | null;
  approved_at?: string | null;
  sent_at?: string | null;
  sent_via?: string | null;
  cancelled_at?: string | null;
  cancellation_reason?: string | null;
  items?: GeneralPODetailItem[];
  payable_amount?: number;
  paid_amount?: number;
  outstanding_amount?: number;
}

export interface ApprovedGeneralPRForPO {
  id: string;
  pr_number: string;
  department_name?: string | null;
  requester_name?: string | null;
  items?: Array<{
    id: string;
    supply_item_id?: string | null;
    satuan_id?: string | null;
    description: string;
    qty: number;
    unit: string;
    estimated_price: number;
  }>;
}
