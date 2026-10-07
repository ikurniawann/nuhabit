export type StockOpnameStatus =
  "draft" | "in_progress" | "completed" | "cancelled";

export type StockOpnameReason = "stock_opname" | "manual_adjustment";

export interface StockOpnamePreviewLine {
  inventory_id: string | null;
  raw_material_id: string;
  material_kode: string;
  material_nama: string;
  satuan: string | null;
  satuan_besar_nama?: string | null;
  satuan_kecil_nama?: string | null;
  konversi_factor?: number | null;
  qty_system: number;
  unit_cost: number;
}

export interface StockOpname {
  id: string;
  opname_number: string;
  warehouse_id: string | null;
  branch_id: string | null;
  opname_date: string;
  status: StockOpnameStatus;
  reason: StockOpnameReason;
  notes: string | null;
  total_lines: number;
  lines_counted: number;
  lines_with_variance: number;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  warehouse?: { id: string; name: string; code: string } | null;
}

export interface StockOpnameLine {
  id: string;
  stock_opname_id: string;
  inventory_id: string;
  raw_material_id: string;
  qty_system: number;
  qty_counted: number | null;
  qty_variance: number | null;
  unit_cost: number;
  notes: string | null;
  material_kode?: string | null;
  material_nama?: string | null;
  satuan?: string | null;
  satuan_besar_nama?: string | null;
  satuan_kecil_nama?: string | null;
  konversi_factor?: number | null;
}

export interface StockOpnameDetail extends StockOpname {
  lines: StockOpnameLine[];
}

export interface StockOpnameListParams {
  page?: number;
  limit?: number;
  status?: StockOpnameStatus | "all";
  warehouse_id?: string;
  search?: string;
  reason?: StockOpnameReason;
}

export interface CreateStockOpnameInput {
  warehouse_id: string;
  opname_date?: string;
  notes?: string;
  reason?: StockOpnameReason;
}

export interface UpdateStockOpnameLineInput {
  id: string;
  qty_counted: number | null;
  notes?: string;
}

export interface UpdateStockOpnameInput {
  notes?: string;
  status?: "cancelled";
  lines?: UpdateStockOpnameLineInput[];
}

export const STOCK_OPNAME_STATUS_LABELS: Record<StockOpnameStatus, string> = {
  draft: "Draf",
  in_progress: "Perhitungan Berjalan",
  completed: "Selesai",
  cancelled: "Dibatalkan",
};

export const STOCK_OPNAME_STATUS_COLORS: Record<StockOpnameStatus, string> = {
  draft: "bg-gray-100 text-gray-700 border-gray-200",
  in_progress: "bg-amber-100 text-amber-700 border-amber-200",
  completed: "bg-green-100 text-green-700 border-green-200",
  cancelled: "bg-red-100 text-red-700 border-red-200",
};
