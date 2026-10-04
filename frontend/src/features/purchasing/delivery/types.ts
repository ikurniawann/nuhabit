import type { DeliveryStatus } from "@/lib/purchasing/receiving-ui-delivery";

export type { DeliveryStatus };

export interface DeliveryRow {
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
  status: DeliveryStatus;
  created_at: string;
}

export interface DeliveryDetail {
  id: string;
  nomor_resi: string;
  no_surat_jalan: string;
  purchase_order_id: string;
  supplier_id: string;
  tanggal_kirim: string;
  tanggal_estimasi_tiba: string;
  tanggal_aktual_tiba: string;
  kurir: string;
  status: DeliveryStatus;
  catatan: string;
  created_at: string;
  supplier?: { id: string; nama: string; kode: string };
  purchase_order?: { id: string; po_number: string; status: string };
}

export interface DeliveryPOOption {
  id: string;
  nomor_po: string;
  supplier_id: string;
  nama_supplier?: string | null;
  status?: string;
  active_delivery_id?: string | null;
}

export interface DeliveryListParams {
  page?: number;
  limit?: number;
  status?: string;
  po_id?: string;
  search?: string;
}

export interface DeliveryListResult {
  data: DeliveryRow[];
  total: number;
  totalPages: number;
}

export interface CreateDeliveryPayload {
  po_id: string;
  supplier_id: string;
  no_surat_jalan: string;
  kurir: string;
  no_resi: string;
  tanggal_kirim: string;
  tanggal_estimasi_tiba: string;
  catatan: string;
}
