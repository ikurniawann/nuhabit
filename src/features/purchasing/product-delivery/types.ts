import type { DeliveryStatus } from "@/lib/purchasing/receiving-ui-delivery";

export type ProductDeliveryStatus = DeliveryStatus;

export interface ProductDeliveryRow {
  id: string;
  delivery_number: string;
  po_id: string;
  po_number: string;
  no_surat_jalan: string;
  ekspedisi: string;
  no_resi: string;
  tanggal_kirim: string;
  tanggal_estimasi_tiba: string;
  tanggal_aktual_tiba: string;
  status: ProductDeliveryStatus;
  created_at: string;
}

export interface ProductDeliveryDetail {
  id: string;
  nomor_resi: string;
  no_surat_jalan: string;
  purchase_order_id: string;
  vendor_id?: string | null;
  tanggal_kirim: string;
  tanggal_estimasi_tiba: string;
  tanggal_aktual_tiba: string;
  kurir: string;
  status: ProductDeliveryStatus;
  catatan: string;
  created_at: string;
  vendor?: { id: string; nama: string; kode: string } | null;
  purchase_order?: { id: string; po_number: string; status: string };
}

export interface ProductDeliveryPOOption {
  id: string;
  nomor_po: string;
  vendor_id?: string | null;
  nama_supplier?: string | null;
  status?: string;
  active_delivery_id?: string | null;
}

export interface ProductDeliveryListParams {
  page?: number;
  limit?: number;
  status?: string;
  po_id?: string;
  search?: string;
}

export interface ProductDeliveryListResult {
  data: ProductDeliveryRow[];
  total: number;
  totalPages: number;
}

export interface CreateProductDeliveryPayload {
  po_id: string;
  vendor_id: string;
  no_surat_jalan: string;
  kurir: string;
  no_resi: string;
  tanggal_kirim: string;
  tanggal_estimasi_tiba: string;
  catatan: string;
  module_type?: "product";
}

/** Item PO produk dari GET /api/purchasing/po-items. */
export interface ProductPOItemRow {
  id: string;
  qty_ordered?: number | string | null;
  harga_satuan?: number | string | null;
  subtotal?: number | string | null;
  product?: { id: string; nama: string; kode?: string | null } | null;
  satuan?: { nama?: string; nama_satuan?: string } | null;
}
