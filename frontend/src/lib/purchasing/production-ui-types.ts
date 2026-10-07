/**
 * Tipe data layar produksi (hub, resep, detail order, editor BOM bahan baku).
 * Dipakai helper murni di src/lib/purchasing/production-ui-* dan fitur
 * src/features/purchasing/production (yang me-re-export dari sini).
 */
export type ProductionProduct = {
  id: string;
  kode?: string | null;
  nama?: string | null;
  kategori?: string | null;
  hpp_estimasi?: number | string | null;
  harga_jual?: number | string | null;
  total_bahan_baku?: number | string | null;
  production_output_type?: "FINISHED_GOOD" | "WIP" | null;
};

export type CogsMaterial = {
  bahan_id: string;
  kode: string;
  nama: string;
  material_type?: "PURCHASED" | "WIP" | string;
  source_product_id?: string | null;
  jumlah: number;
  satuan: string;
  qty_available: number;
  qty_on_order: number;
  unit_cost: number;
  waste_percentage: number;
  effective_qty: number;
  subtotal: number;
  /** Tarif biaya tambahan pembelian bahan ini, persen dari biaya bahan. */
  landed_cost_rate?: number;
  additional_cost?: number;
};

export type CogsData = {
  hpp_per_unit: number;
  total_bom_cost: number;
  /** Biaya tambahan pembelian (freight, bea, handling) per unit, sudah masuk hpp_per_unit. */
  total_additional_cost?: number;
  total_overhead: number;
  breakdown_bahan: CogsMaterial[];
};

// EPIC-047 Fase 1B — SKU POS aktif produk merchandise ber-varian (dari
// matriks Fase 1A). Dipakai form complete + detail order untuk rincian
// output per varian.
export type ProductionPosSku = {
  id: string;
  sku: string;
  name: string;
  options?: Record<string, string> | null;
  stock_quantity?: number | string | null;
};

export type ProductionOrder = {
  id: string;
  nomor_produksi: string;
  production_context?: "product" | "raw_material";
  output_type?: "FINISHED_GOOD" | "WIP";
  product_nama?: string | null;
  product_kode?: string | null;
  output_raw_material_nama?: string | null;
  output_raw_material_kode?: string | null;
  item_nama?: string | null;
  item_kode?: string | null;
  planned_qty: number | string;
  actual_qty: number | string;
  status: string;
  planned_material_cost: number | string;
  actual_material_cost: number | string;
  hpp_per_unit: number | string;
  created_at: string;
};

export type WipInventory = {
  id: string;
  kode: string;
  nama: string;
  kategori: string;
  satuan: string;
  qty_onhand: number | string;
  avg_cost: number | string;
  status_stok: string;
  source_product_id?: string | null;
  source_product?: {
    id: string;
    kode?: string | null;
    nama?: string | null;
    kategori?: string | null;
  } | null;
  latest_batch?: {
    batch_number?: string | null;
    qty_produced?: number | string | null;
    hpp_per_unit?: number | string | null;
    production_order_id?: string | null;
    production_order_number?: string | null;
    created_at?: string | null;
  } | null;
};

export type WipSummary = {
  total_wip: number;
  ready_wip: number;
  total_qty: number;
  total_value: number;
};

export type ProductRecipe = {
  id: string;
  kode?: string | null;
  nama?: string | null;
  kategori?: string | null;
  harga_jual?: number | string | null;
  hpp_estimasi?: number | string | null;
  total_bahan_baku?: number | string | null;
  is_active?: boolean | null;
};

export type RawMaterialRecipe = {
  id: string;
  kode?: string | null;
  nama?: string | null;
  kategori?: string | null;
  avg_cost?: number | string | null;
  hpp_estimasi?: number | string | null;
  total_bahan_baku?: number | string | null;
  is_active?: boolean | null;
};

export interface ProductionDashboardData {
  orders: ProductionOrder[];
  products: ProductionProduct[];
  wipInventory: WipInventory[];
  wipSummary: WipSummary | null;
}

export interface CreateProductionOrderPayload {
  production_context?: "product" | "raw_material";
  product_id?: string;
  raw_material_id?: string;
  output_type?: "FINISHED_GOOD" | "WIP";
  planned_qty: number;
  overhead_cost: number;
  labor_cost: number;
  packaging_cost: number;
}

/** Item daftar resep: produk (punya harga jual) atau bahan baku (punya avg_cost). */
export type RecipeItem = ProductRecipe & Pick<RawMaterialRecipe, "avg_cost">;

export type ProductionMaterial = {
  id: string;
  raw_material_id: string;
  qty_planned: number | string;
  qty_actual: number | string;
  waste_qty: number | string;
  unit_cost: number | string;
  total_cost: number | string;
  inventory_movement_id?: string | null;
  raw_material?: { kode?: string | null; nama?: string | null } | null;
  satuan?: { nama?: string | null } | null;
  stock?: {
    qty_onhand: number;
    required_qty: number;
    shortage_qty: number;
    stock_status: "ENOUGH" | "INSUFFICIENT";
  } | null;
};

// EPIC-047 Fase 1B: rincian output per SKU POS yang sudah diposting untuk satu batch produksi.
export type ProductionBatchVariantOutput = {
  pos_sku_id: string;
  sku: string | null;
  name: string | null;
  options: Record<string, string> | null;
  qty: number | string;
};

export type ProductionBatch = {
  id: string;
  batch_number: string;
  qty_produced: number | string;
  hpp_per_unit: number | string;
  total_cost: number | string;
  output_type?: "FINISHED_GOOD" | "WIP";
  created_at: string;
  variant_outputs?: ProductionBatchVariantOutput[];
};

/** Respons GET /api/purchasing/production/orders/[id]. */
export type ProductionDetail = {
  id: string;
  nomor_produksi: string;
  product_nama?: string | null;
  product_kode?: string | null;
  output_raw_material_nama?: string | null;
  item_nama?: string | null;
  output_type?: "FINISHED_GOOD" | "WIP";
  output_satuan_nama?: string | null;
  planned_qty: number | string;
  actual_qty: number | string;
  status: string;
  planned_material_cost: number | string;
  actual_material_cost: number | string;
  overhead_cost: number | string;
  labor_cost: number | string;
  packaging_cost: number | string;
  waste_cost: number | string;
  hpp_per_unit: number | string;
  catatan?: string | null;
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
  cancelled_at?: string | null;
  materials: ProductionMaterial[];
  batches: ProductionBatch[];
  stock_summary?: {
    total_materials: number;
    insufficient_materials: number;
    can_release: boolean;
  };
  // EPIC-047 Fase 1B: SKU POS aktif produk (kalau tertaut merchandise) dan
  // apakah rincian per varian wajib diisi saat complete.
  pos_skus?: ProductionPosSku[];
  variant_required?: boolean;
};

/** Baris BOM bahan baku (GET /api/purchasing/raw-materials/[id]/bom). */
export type RawMaterialBomRow = {
  id: string;
  raw_material_id?: string;
  component_raw_material_id?: string;
  qty_required?: number | string;
  waste_factor?: number | string;
  cost_per_unit?: number | string;
  total_cost?: number | string;
};

export type ProductionOrderAction = "recheck_stock" | "release" | "start" | "cancel" | "complete";
