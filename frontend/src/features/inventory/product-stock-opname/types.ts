export type ProductStockOpnameStatus =
  "draft" | "in_progress" | "completed" | "cancelled";

export type ProductStockOpnameReason = "stock_opname" | "manual_adjustment";

export interface ProductStockOpnamePreviewLine {
  inventory_id: string | null;
  product_id: string;
  product_kode: string;
  product_nama: string;
  satuan: string | null;
  qty_system: number;
  unit_cost: number;
  // EPIC-047 Fase 3 — terisi saat baris ini mewakili satu SKU (produk
  // merchandise POS ber-varian); null/undefined = baris level produk lama.
  pos_sku_id?: string | null;
  pos_sku_code?: string | null;
  pos_sku_name?: string | null;
}

export interface ProductStockOpname {
  id: string;
  opname_number: string;
  company_id: string | null;
  branch_id: string | null;
  warehouse_id: string | null;
  opname_date: string;
  status: ProductStockOpnameStatus;
  reason: ProductStockOpnameReason;
  notes: string | null;
  total_lines: number;
  lines_counted: number;
  lines_with_variance: number;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  branch?: { id: string; name: string; code: string } | null;
  warehouse?: { id: string; name: string; code: string } | null;
}

export interface ProductStockOpnameLine {
  id: string;
  product_stock_opname_id: string;
  inventory_id: string;
  product_id: string;
  qty_system: number;
  qty_counted: number | null;
  qty_variance: number | null;
  unit_cost: number;
  notes: string | null;
  product_kode?: string | null;
  product_nama?: string | null;
  satuan?: string | null;
  // EPIC-047 Fase 3 — terisi saat baris ini mewakili satu SKU (produk
  // merchandise POS ber-varian); null/undefined = baris level produk lama.
  pos_sku_id?: string | null;
  pos_sku_code?: string | null;
  pos_sku_name?: string | null;
}

export interface ProductStockOpnameDetail extends ProductStockOpname {
  lines: ProductStockOpnameLine[];
}

export interface ProductStockOpnameListParams {
  page?: number;
  limit?: number;
  status?: ProductStockOpnameStatus | "all";
  search?: string;
  reason?: ProductStockOpnameReason;
  warehouse_id?: string;
}

export interface CreateProductStockOpnameInput {
  warehouse_id: string;
  opname_date?: string;
  notes?: string;
  reason?: ProductStockOpnameReason;
}

export interface UpdateProductStockOpnameLineInput {
  id: string;
  qty_counted: number | null;
  notes?: string;
}

export interface UpdateProductStockOpnameInput {
  notes?: string;
  status?: "cancelled";
  lines?: UpdateProductStockOpnameLineInput[];
}

export const PRODUCT_STOCK_OPNAME_STATUS_LABELS: Record<
  ProductStockOpnameStatus,
  string
> = {
  draft: "Draf",
  in_progress: "Perhitungan Berjalan",
  completed: "Selesai",
  cancelled: "Dibatalkan",
};

export const PRODUCT_STOCK_OPNAME_STATUS_COLORS: Record<
  ProductStockOpnameStatus,
  string
> = {
  draft: "bg-gray-100 text-gray-700 border-gray-200",
  in_progress: "bg-amber-100 text-amber-700 border-amber-200",
  completed: "bg-green-100 text-green-700 border-green-200",
  cancelled: "bg-red-100 text-red-700 border-red-200",
};
