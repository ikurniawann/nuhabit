/** Satu batch bahan baku mendekati atau lewat kedaluwarsa (Go /api/inventory/expiring). */
export interface ExpiringBatchRow {
  id: string;
  inventory_id: string;
  raw_material_id: string;
  material_kode: string;
  material_nama: string;
  satuan: string | null;
  warehouse_id: string | null;
  warehouse_nama: string | null;
  branch_id: string | null;
  branch_nama: string | null;
  batch_number: string | null;
  expiry_date: string;
  days_left: number;
  qty_remaining: number;
  avg_cost: number;
  value_at_risk: number;
  source_type: string;
  received_at: string;
}
