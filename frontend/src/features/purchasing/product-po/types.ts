export type ProductPOStatus =
  | "draft"
  | "approved"
  | "sent"
  | "partially_received"
  | "partial"
  | "received"
  | "cancelled";

export interface ProductPOListParams {
  page?: number;
  limit?: number;
  status?: string;
  search?: string;
}

export interface ProductPOListItem {
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

export interface ProductPOListResult {
  data: ProductPOListItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}

export interface ProductPOItemFormInput {
  product_id: string;
  pr_item_id?: string;
  satuan_id?: string;
  qty_ordered: number;
  harga_satuan: number;
  notes?: string;
  /** EPIC-047 Fase 2 — SKU varian, wajib untuk produk ber-varian. */
  pos_sku_id?: string | null;
}

export interface ProductPOFormInput {
  vendor_id: string;
  pr_id?: string;
  tanggal_po: string;
  tanggal_kirim_estimasi?: string;
  catatan?: string;
  alamat_pengiriman?: string;
  diskon_persen: number;
  diskon_nominal: number;
  ppn_persen: number;
  items: ProductPOItemFormInput[];
}

export interface ProductPOFormPayload extends ProductPOFormInput {
  module_type?: "product";
}

/** EPIC-047 Fase 2 — SKU merchandise aktif milik satu produk (untuk baris PO per varian). */
export interface ProductPOFormProductSku {
  id: string;
  sku: string;
  name: string;
  options?: Record<string, string> | null;
  stock_quantity?: number | null;
}

export interface ProductPOFormProduct {
  id: string;
  kode: string;
  nama: string;
  satuan_id?: string | null;
  satuan_nama?: string | null;
  harga_modal?: number | null;
  /** Kosong untuk produk tanpa varian; >=1 baris = produk ber-varian, SKU wajib dipilih di form. */
  pos_skus?: ProductPOFormProductSku[];
}

export interface ProductPOFormVendor {
  id: string;
  code: string;
  name: string;
}

export interface ProductPOFormData {
  vendors: ProductPOFormVendor[];
  products: ProductPOFormProduct[];
  units: { id: string; nama: string; kode?: string }[];
}

export interface ProductPODetailItem {
  id: string;
  product_id?: string | null;
  satuan_id?: string | null;
  qty_ordered?: number | null;
  qty_received?: number | null;
  harga_satuan?: number | null;
  subtotal?: number | null;
  catatan?: string | null;
  product?: { id: string; kode: string; nama: string } | null;
  satuan?: { id: string; nama: string } | null;
}

export interface ProductPODetail extends ProductPOListItem {
  catatan?: string | null;
  alamat_pengiriman?: string | null;
  approved_at?: string | null;
  sent_at?: string | null;
  sent_via?: string | null;
  cancelled_at?: string | null;
  cancellation_reason?: string | null;
  items?: ProductPODetailItem[];
  payable_amount?: number;
  paid_amount?: number;
  outstanding_amount?: number;
}

export interface ApprovedProductPRForPO {
  id: string;
  pr_number: string;
  department_name?: string | null;
  requester_name?: string | null;
  items?: Array<{
    id: string;
    product_id?: string | null;
    satuan_id?: string | null;
    description: string;
    qty: number;
    unit: string;
    estimated_price: number;
    product?: { id: string; kode: string; nama: string };
  }>;
}
