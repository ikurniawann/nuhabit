export type StockStatus = "normal" | "low_stock" | "out_of_stock" | "overstock";

export interface InventoryItem {
  id: string;
  raw_material_id: string;
  material_kode: string;
  material_nama: string;
  material_kategori: string;
  qty_available: number;
  qty_minimum: number;
  qty_maximum?: number;
  unit_cost: number;
  total_value: number;
  stock_status: StockStatus;
  last_movement_at?: string;
  lokasi_rak?: string;
  satuan?: string;
}

export interface InventoryListParams {
  page?: number;
  limit?: number;
  status?: string;
  search?: string;
}

export interface InventoryListResult {
  items: InventoryItem[];
  total: number;
}

export interface InventorySummary {
  total: number;
  low: number;
  out: number;
  totalValue: number;
}

export interface InventoryMovement {
  id: string;
  tipe: string;
  jumlah: number;
  qty_before: number;
  qty_after: number;
  unit_cost: number;
  total_cost: number;
  reference_type: string;
  reference_number: string;
  alasan: string;
  catatan?: string;
  created_at: string;
}

export interface InventoryMovementsParams {
  id: string;
  page?: number;
  limit?: number;
}

export interface InventoryMovementsResult {
  data: InventoryMovement[];
  total: number;
}
