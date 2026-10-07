/**
 * Tipe data layar laporan Items/Purchasing (src/features/purchasing/reports
 * me-re-export dari sini supaya helper murni report-ui-* bisa memakainya).
 */
export interface SupplierPerfRow {
  id: string;
  rank?: number;
  supplier_code?: string;
  supplier_name?: string;
  contact_person?: string;
  telepon?: string;
  email?: string;
  total_po?: number;
  completed_po?: number;
  on_time_count?: number;
  late_count?: number;
  on_time_rate?: number | null;
  reject_rate?: number;
  avg_lead_time_days?: number | null;
  total_value?: number;
  avg_po_value?: number;
  quality_score?: number;
  rating?: number;
}

export interface POSummary {
  po_number: string;
  vendor: string;
  vendor_code: string;
  status: string;
  tanggal_po: string;
  tanggal_diterima?: string;
  total_amount: number;
  total_amount_formatted: string;
  mata_uang: string;
  item_count: number;
  created_by: string;
}

export interface StatusSummary {
  status: string;
  count: number;
  total: number;
  total_formatted: string;
}

export interface POSummaryResult {
  summary: POSummary[];
  byStatus: StatusSummary[];
  grandTotal: number;
}

export interface POSummaryParams {
  date_from?: string;
  date_to?: string;
  status?: string;
  vendor_id?: string;
}

export interface PODetailParams {
  date_from?: string;
  date_to?: string;
  status?: string;
  vendor_id?: string;
}

export type StockMovementType =
  | "all"
  | "in"
  | "out"
  | "adjustment"
  | "transfer"
  | "return";

export type StockCardItemType = "raw_material" | "product";

export interface StockMaterial {
  id: string;
  kode: string;
  nama: string;
  kategori: string;
  satuan: string;
  lokasi_rak: string;
  qty_onhand: number;
  avg_cost: number;
  min_stock: number;
  max_stock: number | null;
  status_stok: string;
  warehouse_id?: string | null;
  warehouse_name?: string | null;
}

export interface StockMovement {
  id: string;
  item_id?: string;
  raw_material_id: string;
  material_kode: string;
  material_nama: string;
  material_kategori: string;
  item_kode?: string;
  item_nama?: string;
  item_kategori?: string;
  tipe: Exclude<StockMovementType, "all">;
  jumlah: number;
  qty_before: number;
  qty_after: number;
  unit_cost: number;
  total_cost: number;
  reference_type: string;
  reference_number: string;
  alasan: string;
  catatan: string;
  created_at: string | null;
  warehouse_id?: string | null;
}

export interface StockCardSummary {
  opening_balance: number;
  closing_balance: number;
  total_in: number;
  total_out: number;
  total_adjustment_in: number;
  total_adjustment_out: number;
  total_return: number;
  total_transfer: number;
  total_value: number;
  movement_count: number;
}

export interface StockCardResponse {
  item_type?: StockCardItemType;
  items?: StockMaterial[];
  materials: StockMaterial[];
  selected_item?: StockMaterial | null;
  selected_material: StockMaterial | null;
  movements: StockMovement[];
  summary: StockCardSummary;
}

export interface StockCardParams {
  item_type?: StockCardItemType;
  material_id?: string;
  product_id?: string;
  item_id?: string;
  warehouse_id?: string;
  search?: string;
  tipe?: Exclude<StockMovementType, "all">;
  date_from?: string;
  date_to?: string;
  limit?: number;
}

export interface InventoryApiRow {
  id?: string;
  raw_material_id?: string;
  kode?: string;
  nama?: string;
  kategori?: string;
  lokasi_rak?: string;
  qty_onhand?: number;
  min_stock?: number;
  stok_minimum?: number;
  max_stock?: number | null;
  stok_maximum?: number | null;
  avg_cost?: number;
  unit_cost?: number;
  satuan?: string;
  satuan_besar_nama?: string;
}

export interface InventoryValuationParams {
  date_from?: string;
  date_to?: string;
}

export type PoSummaryExportFormat = "csv" | "json";

export interface PoSummaryExportResult {
  blob: Blob;
  extension: PoSummaryExportFormat;
}

export type ProductionDateField = "completed_at" | "created_at";
export type ProductionOutputTypeFilter = "all" | "FINISHED_GOOD" | "WIP";

export interface ProductionInHouseParams {
  date_from?: string;
  date_to?: string;
  date_field?: ProductionDateField;
  status?: string;
  output_type?: ProductionOutputTypeFilter;
  product_id?: string;
  warehouse_id?: string;
}

export interface ProductionInHouseOrder {
  id: string;
  nomor_produksi: string;
  product_id: string | null;
  product_kode: string;
  product_nama: string;
  output_type: string;
  status: string;
  planned_qty: number;
  actual_qty: number;
  hpp_per_unit: number;
  hpp_per_unit_formatted: string;
  actual_material_cost: number;
  overhead_cost: number;
  labor_cost: number;
  packaging_cost: number;
  waste_cost: number;
  total_hpp_value: number;
  total_hpp_value_formatted: string;
  warehouse_id: string | null;
  warehouse_name: string | null;
  warehouse_code: string | null;
  created_at: string | null;
  started_at: string | null;
  completed_at: string | null;
}

export interface ProductionInHouseStatusRow {
  status: string;
  count: number;
  actual_qty: number;
  hpp_value: number;
  hpp_value_formatted: string;
}

export interface ProductionInHouseSummary {
  total_orders: number;
  total_planned_qty: number;
  total_actual_qty: number;
  total_hpp_value: number;
  completed_orders: number;
}

export interface ProductionInHouseResult {
  orders: ProductionInHouseOrder[];
  byStatus: ProductionInHouseStatusRow[];
  summary: ProductionInHouseSummary;
}

export interface PODetailLine {
  id: string;
  nama_bahan: string;
  kode_bahan?: string;
  qty_order: number;
  qty_received: number;
  harga_satuan: number;
  satuan?: string;
  subtotal: number;
}

/** Satu PO di laporan Detail PO setelah dinormalisasi dari respons API. */
export interface PODetailRow {
  id: string;
  no_po: string;
  tanggal_po: string;
  supplier: string;
  vendor_code?: string;
  supplier_id?: string;
  status: string;
  total: number;
  item_count: number;
  items: PODetailLine[];
}
