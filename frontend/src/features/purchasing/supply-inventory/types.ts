// EPIC-026 C2 — Tipe inventory riil barang operasional.

export interface SupplyStockRow {
  id: string;
  supply_item_id: string;
  warehouse_id: string | null;
  warehouse_nama: string | null;
  item_kode: string | null;
  item_nama: string | null;
  item_kategori: string | null;
  satuan_nama: string | null;
  qty_available: number;
  qty_on_order: number;
  qty_minimum: number;
  unit_cost: number;
  last_movement_at: string | null;
}

export interface SupplyStockMovement {
  id: string;
  tipe: "in" | "out" | "adjustment" | "return";
  jumlah: number;
  qty_before: number;
  qty_after: number;
  unit_cost: number | null;
  total_cost: number | null;
  reference_type: string | null;
  reference_id: string | null;
  reference_number: string | null;
  alasan: string | null;
  catatan: string | null;
  created_at: string;
}

export interface SupplyStockDetail extends SupplyStockRow {
  stockable: boolean;
  branch_id: string | null;
  movements: SupplyStockMovement[];
}

export interface SupplyStockListParams {
  search?: string;
  warehouse_id?: string;
  low_stock?: boolean;
}

export interface SupplyInventoryFormData {
  warehouses: { id: string; name: string; code: string }[];
  supplies: { id: string; kode: string; nama: string; satuan_id: string | null; stok_minimum: number }[];
  units: { id: string; nama: string; kode: string }[];
}

export interface SupplyUsageListRow {
  id: string;
  nomor: string;
  tanggal: string;
  warehouse_id: string | null;
  warehouse_nama: string | null;
  divisi: string | null;
  keperluan: string | null;
  total_items: number;
  created_at: string;
}

export interface SupplyUsageItemInput {
  supply_item_id: string;
  qty: number;
  catatan?: string;
}

export interface CreateSupplyUsagePayload {
  warehouse_id: string;
  tanggal?: string;
  divisi?: string;
  keperluan?: string;
  catatan?: string;
  items: SupplyUsageItemInput[];
}

export interface SupplyAdjustmentPayload {
  supply_item_id: string;
  warehouse_id: string;
  qty_actual: number;
  notes?: string;
}

export const MOVEMENT_LABELS: Record<SupplyStockMovement["tipe"], string> = {
  in: "Masuk",
  out: "Keluar",
  adjustment: "Penyesuaian",
  return: "Retur",
};

export const MOVEMENT_STYLES: Record<SupplyStockMovement["tipe"], string> = {
  in: "bg-emerald-100 text-emerald-700",
  out: "bg-rose-100 text-rose-700",
  adjustment: "bg-amber-100 text-amber-700",
  return: "bg-blue-100 text-blue-700",
};
