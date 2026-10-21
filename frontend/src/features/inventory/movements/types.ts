/** Satu baris mutasi stok bahan baku (Go /api/inventory/movements). */
export interface MovementRow {
  id: string;
  created_at: string;
  raw_material_id: string;
  material_kode: string;
  material_nama: string;
  satuan: string | null;
  warehouse_id: string | null;
  warehouse_nama: string | null;
  tipe: string;
  direction: "in" | "out" | "none";
  jumlah: number;
  qty_before: number;
  qty_after: number;
  unit_cost: number | null;
  total_cost: number | null;
  reference_type: string | null;
  reference_number: string | null;
  reference_id: string | null;
  batch_numbers: string | null;
  alasan: string | null;
  created_by_name: string | null;
}

export interface MovementFilters {
  raw_material_id: string;
  warehouse_id: string;
  tipe: string;
  reference_type: string;
  reference: string;
  date_from: string;
  date_to: string;
}
