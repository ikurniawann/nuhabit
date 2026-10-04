import type { ProductStockVariant } from "@/lib/inventory/finished-goods-stock";

export type RawStockStatus = "AMAN" | "MENIPIS" | "HABIS";

export interface RawMaterialStockItem {
  id: string;
  kode: string;
  nama: string;
  kategori: string | null;
  qty_onhand: number;
  min_stock: number;
  max_stock?: number | null;
  unit_cost: number;
  avg_cost?: number | null;
  total_value: number;
  status_stok: RawStockStatus;
  satuan?: string | null;
  satuan_besar_nama?: string | null;
  satuan_kecil_nama?: string | null;
  konversi_factor?: number | null;
  harga_beli?: number | null;
  warehouse_id?: string | null;
  warehouse_nama?: string | null;
}

/** EPIC-047 Fase 1C — satu baris SKU aktif produk merchandise ber-varian. */
export type { ProductStockVariant };

export interface ProductStockItem {
  id: string;
  product_id: string;
  product_kode: string;
  product_nama: string;
  product_kategori: string | null;
  qty_available: number;
  unit_cost: number;
  harga_jual: number;
  total_value: number;
  satuan_nama?: string | null;
  last_movement_at?: string | null;
  warehouse_id?: string | null;
  warehouse_name?: string | null;
  warehouse_code?: string | null;
  /** EPIC-047 Fase 1C — kosong untuk produk tanpa SKU (F&B). */
  variants?: ProductStockVariant[];
  variant_count?: number;
}

export interface StockListParams {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
  warehouse_id?: string;
}

export interface StockListResult<T> {
  items: T[];
  total: number;
}

export interface StockSummary {
  total: number;
  attention: number;
  totalValue: number;
}
