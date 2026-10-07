// EPIC-026 B1 — tipe master barang operasional (scope 'general').

export interface SupplyItem {
  id: string;
  kode: string;
  nama: string;
  deskripsi: string | null;
  kategori: string | null;
  satuan_id: string | null;
  stockable: boolean;
  harga_beli: number;
  stok_minimum: number | null;
  is_active: boolean;
  company_id: string | null;
  branch_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface SupplyItemFormData {
  kode?: string;
  nama: string;
  deskripsi?: string | null;
  kategori?: string | null;
  satuan_id?: string | null;
  stockable: boolean;
  harga_beli: number;
  stok_minimum?: number;
  is_active?: boolean;
}

export interface SupplyItemListParams {
  search?: string;
  is_active?: "true" | "false";
  stockable?: "true" | "false";
  page?: number;
  limit?: number;
}

export interface SupplyItemListResult {
  data: SupplyItem[];
  pagination: { page: number; limit: number; total: number; total_pages: number };
}
