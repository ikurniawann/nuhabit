export interface LowStockItem {
  id: string;
  raw_material_id: string;
  material_kode: string;
  material_nama: string;
  kategori: string;
  qty_available: number;
  qty_minimum: number;
  qty_on_order: number;
  /** null = tidak ada stok maksimum (saran memakai aturan minimum x 1,5). */
  qty_maximum: number | null;
  unit_cost: number;
  satuan: string;
  stock_status: string;
  shortage_qty: number;
  suggested_order_qty: number;
  suggestion_basis: "maximum" | "minimum_buffer";
  estimated_cost: number;
  supplier_id?: string | null;
  supplier_name?: string;
  last_purchase_date?: string;
}

export interface LowStockParams {
  category?: string;
  status?: string;
}
