// ============================================
// PURCHASE ORDER TYPES
// ============================================

export type POStatus = 
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'sent'
  | 'partial'
  | 'partially_received'
  | 'received'
  | 'rejected'
  | 'cancelled'
  | 'closed';

export interface Supplier {
  id: string;
  nama_supplier: string;
  kode_supplier: string;
  kode?: string;
  alamat?: string;
  telepon?: string;
  pic_phone?: string | null;
  email?: string;
  npwp?: string;
  status: string;
  kota?: string;
  pic_name?: string;
  pic_email?: string | null;
  pic_jabatan?: string | null;
  catatan?: string | null;
  is_active?: boolean;
  payment_terms?: string;
  currency?: string;
}

export interface RawMaterialWithStock {
  id: string;
  kode: string;
  nama: string;
  satuan?: string;
  stock?: number;
  harga_terakhir?: number;
  harga_avg?: number;
  avg_cost?: number;
  satuan_besar_nama?: string;
  satuan_besar?: { nama: string };
}

export interface Unit {
  id: string;
  kode: string;
  nama: string;
  simbol?: string;
  tipe: "BESAR" | "KECIL" | "KONVERSI";
  deskripsi: string;
  is_active: boolean;
}

export interface RawMaterialUnitConversion {
  id?: string;
  raw_material_id?: string;
  satuan_id: string;
  qty_in_base_unit: number;
  is_base?: boolean;
  is_active?: boolean;
  /** Pack bawaan baris PO baru. */
  is_purchase_default?: boolean;
  satuan?: Unit;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
  summary?: RawMaterialStockSummary;
}

export interface RawMaterialStockSummary {
  total: number;
  aman: number;
  menipis: number;
  habis: number;
}

// ============================================
// PURCHASE REQUEST TYPES
// ============================================

export type PRStatus = 
  | 'draft'
  | 'pending_head'
  | 'pending_finance'
  | 'pending_direksi'
  | 'approved'
  | 'rejected'
  | 'converted';

export interface PRItem {
  id: string;
  pr_id: string;
  raw_material_id?: string | null;
  satuan_id?: string | null;
  qty_requested?: number;
  qty_approved?: number;
  unit_price?: number;
  subtotal?: number;
  notes?: string;
  description?: string;
  qty?: number;
  unit?: string;
  estimated_price?: number;
  total?: number;
  
  raw_material?: {
    id?: string;
    kode: string;
    nama: string;
    satuan?: string;
  };
  satuan?: { id?: string; nama: string };
}

export interface PurchaseRequest {
  id: string;
  pr_number: string;
  request_date?: string;
  requester_id?: string;
  department_id?: string;
  status: PRStatus;
  total_amount?: number;
  priority?: "low" | "medium" | "high" | "urgent";
  notes?: string;
  required_date?: string | null;
  requested_by?: string;
  approved_by?: string;
  approved_at?: string | null;
  converted_po_id?: string | null;
  created_at: string;
  updated_at: string;
  
  items?: PRItem[];
  department?: { name: string; code?: string };
  requester?: { full_name: string };
}

export interface SupplierPriceListFormData {
  supplier_id: string;
  raw_material_id?: string;
  unit_id?: string;
  price?: number;
  effective_date?: string;
  expiry_date?: string;
  notes?: string;
  bahan_baku_id?: string;
  harga?: number;
  satuan_id?: string;
  minimum_qty?: number;
  lead_time_days?: number;
  is_preferred?: boolean;
  berlaku_dari?: string;
  berlaku_sampai?: string;
  catatan?: string;
}

export interface SupplierFormData {
  kode_supplier: string;
  nama_supplier: string;
  alamat?: string;
  telepon?: string;
  email?: string;
  npwp?: string;
  kota?: string;
  pic_name?: string;
  pic_phone?: string;
  pic_email?: string;
  pic_jabatan?: string;
  catatan?: string;
  status?: string;
  payment_terms?: string;
  currency?: string;
  bank_nama?: string;
  bank_rekening?: string;
  bank_atas_nama?: string;
  kategori?: string;
}

export interface UnitFormData {
  kode: string;
  nama: string;
  tipe: "BESAR" | "KECIL" | "KONVERSI";
  deskripsi?: string;
}

export interface SupplierPriceList {
  id: string;
  supplier_id: string;
  raw_material_id: string;
  unit_id: string;
  price: number;
  effective_date: string;
  expiry_date?: string | null;
  is_preferred: boolean;
  minimum_qty?: number;
  lead_time_days?: number;
  notes?: string | null;
  created_at: string;
  updated_at: string;
  
  supplier?: { nama_supplier: string; kode_supplier?: string; kode?: string };
  raw_material?: { kode: string; nama: string };
  unit?: { nama: string; simbol?: string };
  satuan?: { nama: string };
  
  // Legacy field names for compatibility
  bahan_baku_id?: string;
  bahan_baku?: { kode: string; nama: string };
  harga?: number;
  satuan_id?: string;
  berlaku_dari?: string;
  berlaku_sampai?: string;
  catatan?: string | null;
}

// ============================================
// PRODUCT & BOM TYPES
// ============================================

export type ProductOutputType = "FINISHED_GOOD" | "WIP";

export interface ProductFormData {
  nama_produk?: string;
  kode_produk?: string;
  category?: string;
  unit_id?: string;
  satuan_id?: string | null;
  warehouse_id?: string;
  harga_jual?: number;
  notes?: string;
  production_output_type?: ProductOutputType;
  station?: string;
  // Legacy fields for compatibility
  nama?: string;
  kategori?: string;
  deskripsi?: string;
  markup_persen?: number;
  is_active?: boolean;
  harga_modal?: number;
}

export interface ProductWithCOGS {
  id: string;
  nama_produk: string;
  kode_produk: string;
  category?: string;
  unit_id: string;
  harga_jual: number;
  cog: number;
  profit_margin?: number;
  notes?: string;
  created_at: string;
  updated_at: string;
  
  unit?: { nama: string; simbol?: string };
  bom_items?: BOMItem[];
  
  // Legacy fields for compatibility
  nama?: string;
  kode?: string;
  kategori?: string;
  deskripsi?: string;
  markup_persen?: number;
  is_active?: boolean;
  hpp_estimasi?: number;
  harga_modal?: number;
  total_bahan_baku?: number;
  hpp_tersimpan?: number;
  hpp_resep?: number;
  hpp_selisih?: number;
  hpp_perlu_review?: boolean;
  satuan_id?: string | null;
  satuan_nama?: string | null;
  production_output_type?: ProductOutputType;
  station?: string | null;
  warehouse_id?: string;
  warehouse_name?: string | null;
  warehouse_code?: string | null;
  /** EPIC-047 Fase 1A — jumlah SKU aktif POS merchandise tertaut (source_product_id) */
  variant_count?: number;
}

export type Product = ProductWithCOGS;

export interface BOMItem {
  id: string;
  product_id: string;
  raw_material_id: string;
  qty: number;
  qty_required?: number;
  unit_id: string;
  satuan_id?: string | null;
  cost: number;
  cost_per_unit?: number;
  total_cost?: number;
  waste_factor?: number;
  is_active?: boolean;
  created_at: string;
  updated_at: string;
  
  raw_material?: {
    kode: string;
    nama: string;
    satuan?: string;
    satuan_kecil_nama?: string;
    satuan_besar_nama?: string;
    satuan_kecil?: { nama?: string; kode?: string; simbol?: string };
    satuan_besar?: { nama?: string; kode?: string; simbol?: string };
  };
  unit?: { nama: string; simbol?: string };
  satuan?: { nama: string };
  
  // Legacy fields for compatibility
  qty_needed?: number;
  waste_persen?: number;
  subtotal?: number;
}

export interface BOMItemFormData {
  raw_material_id: string;
  qty_required?: number;
  qty_needed?: number;
  waste_persen?: number;
  waste_factor?: number;
  unit_id?: string;
  satuan_id?: string | null;
  cost?: number;
}

export type MaterialCategory = string;

export interface RawMaterialWithStock {
  id: string;
  kode: string;
  nama: string;
  satuan?: string;
  stock?: number;
  harga_terakhir?: number;
  harga_avg?: number;
  satuan_besar?: { nama: string };
  category?: MaterialCategory;
  is_active?: boolean;
  min_stock?: number;
  // Legacy fields for compatibility
  kategori?: MaterialCategory;
  deskripsi?: string;
  satuan_besar_id?: string;
  satuan_kecil_id?: string;
  konversi_factor?: number;
  stok_minimum?: number;
  stok_maximum?: number;
  shelf_life_days?: number;
  is_konversi?: boolean;
  storage_condition?: string;
  coa_production?: string;
  coa_rnd?: string;
  coa_asset?: string;
  hpp?: number;
  harga_beli?: number;
  avg_cost?: number;
  satuan_besar_nama?: string;
  satuan_kecil_nama?: string;
  stok_akhir?: number;
  status_stok?: string;
  qty_onhand?: number;
  qty_reserved?: number;
  qty_available?: number;
  qty_on_order?: number;
  material_type?: "PURCHASED" | "WIP";
  source_product_id?: string | null;
  unit_conversions?: RawMaterialUnitConversion[];
}

export type RawMaterial = RawMaterialWithStock;

export interface RawMaterialFormData {
  kode?: string;
  nama?: string;
  kode_bahan?: string;
  nama_bahan?: string;
  kategori?: MaterialCategory;
  satuan_besar_id: string;
  satuan_kecil_id?: string | null;
  harga_beli?: number;
  konversi_factor?: number;
  stok_minimum?: number;
  stok_maximum?: number | null;
  shelf_life_days?: number;
  storage_condition?: string;
  coa_production?: string | null;
  coa_rnd?: string | null;
  coa_asset?: string | null;
  deskripsi?: string;
  is_active?: boolean;
  unit_conversions?: RawMaterialUnitConversion[];
}

export interface RawMaterialListParams {
  search?: string;
  kategori?: MaterialCategory;
  satuan_besar_id?: string;
  is_active?: boolean;
  below_minimum?: boolean;
  page?: number;
  limit?: number;
  sort_by?: "kode_bahan" | "nama_bahan" | "kategori" | "created_at" | "nama";
  sort_dir?: "ASC" | "DESC";
}

export interface Inventory {
  id: string;
  raw_material_id: string;
  qty_onhand: number;
  qty_reserved?: number;
  qty_available?: number;
  avg_cost?: number;
  updated_at?: string;
}

export interface InventoryMovement {
  id: string;
  raw_material_id: string;
  tipe: string;
  jumlah: number;
  unit_cost?: number | null;
  total_cost?: number | null;
  reference_type?: string | null;
  reference_id?: string | null;
  alasan?: string | null;
  created_at?: string;
}

export interface InventoryAdjustmentForm {
  raw_material_id: string;
  qty_adjustment: number;
  reason: string;
  notes?: string;
}

export interface POListParams {
  page?: number;
  limit?: number;
  search?: string;
  supplier_id?: string;
  status?: POStatus | "all";
  date_from?: string;
  date_to?: string;
  tanggal_mulai?: string;
  tanggal_sampai?: string;
  sort_by?: string;
  sort_order?: "ASC" | "DESC";
}

export interface Delivery {
  id: string;
  delivery_number: string;
  po_id?: string | null;
  supplier_id?: string | null;
  status?: string;
  delivery_date?: string | null;
  created_at?: string;
}

export interface DeliveryFormData {
  po_id: string;
  delivery_date?: string;
  notes?: string;
  items?: Array<Record<string, unknown>>;
}

export interface GoodsReceipt {
  id: string;
  grn_number: string;
  po_id?: string | null;
  supplier_id?: string | null;
  status?: string;
  received_date?: string | null;
  created_at?: string;
}

export interface GoodsReceiptItem {
  id: string;
  grn_id: string;
  raw_material_id: string;
  qty_ordered?: number;
  qty_received?: number;
  unit_price?: number;
  batch_number?: string | null;
  expiry_date?: string | null;
}

export interface GoodsReceiptItemFormData {
  po_item_id?: string;
  raw_material_id: string;
  qty_received: number;
  unit_price?: number;
  batch_number?: string;
  expiry_date?: string;
}

export interface GoodsReceiptFormData {
  po_id: string;
  received_date?: string;
  notes?: string;
  items: GoodsReceiptItemFormData[];
}

export interface QCInspection {
  id: string;
  grn_item_id: string;
  status: string;
  inspected_at?: string;
  notes?: string | null;
}

export interface QCInspectionFormData {
  grn_item_id: string;
  status: string;
  notes?: string;
}

export type Return = PurchaseReturn;
export type ReturnFormData = PurchaseReturnFormData;

export interface PurchaseOrderFormData {
  supplier_id: string;
  pr_id?: string;
  tanggal_po: string;
  tanggal_kirim_estimasi: string;
  catatan: string;
  alamat_pengiriman: string;
  diskon_persen: number;
  diskon_nominal: number;
  ppn_persen: number;
  source_type?: "manual" | "production_order" | "low_stock";
  production_order_id?: string | null;
  source_reference?: string | null;
  items: PurchaseOrderItemFormData[];
}

export interface PurchaseOrderItemFormData {
  raw_material_id: string;
  pr_item_id?: string;
  satuan_id?: string;
  qty_ordered: number;
  harga_satuan: number;
  notes: string;
}

export interface PurchaseOrder {
  id: string;
  nomor_po: string;
  pr_id?: string | null;
  pr_number?: string | null;
  supplier_id: string;
  tanggal_po: string;
  tanggal_kirim_estimasi: string | null;
  status: POStatus;
  subtotal?: number;
  diskon_persen?: number;
  diskon_nominal?: number;
  ppn_persen?: number;
  ppn_nominal?: number;
  grand_total?: number;
  catatan: string | null;
  alamat_pengiriman?: string | null;
  approved_at?: string | null;
  sent_at?: string | null;
  sent_via?: string | null;
  cancelled_at?: string | null;
  source_type?: "manual" | "production_order" | "low_stock" | null;
  production_order_id?: string | null;
  production_order_number?: string | null;
  source_reference?: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  
  nama_supplier?: string;
  supplier_kode?: string;
  supplier?: { nama_supplier: string; alamat?: string };
  items?: PurchaseOrderItem[];
}

export interface PurchaseOrderItem {
  id: string;
  po_id: string;
  raw_material_id: string;
  qty_ordered: number;
  qty_received: number;
  harga_satuan: number;
  subtotal: number;
  notes: string | null;
  satuan?: { nama: string };
  
  raw_material?: {
    kode: string;
    nama: string;
    satuan?: string;
    satuan_besar?: { nama: string };
    satuan_kecil?: { nama: string };
  };
}

export interface PurchaseOrderWithStats extends PurchaseOrder {
  total_received: number;
  total_pending: number;
  received_percentage: number;
  receive_percentage?: number;
  progress_pct?: number;
  total_qty_received: number;
  total_qty_ordered: number;
  payment_term_count?: number;
  payable_amount?: number;
  paid_amount?: number;
  outstanding_amount?: number;
  next_due_date?: string | null;
  payment_progress_pct?: number;
  receiving_status?: "not_received" | "partial" | "received";
  payment_status?: "unpaid" | "partial" | "paid" | "overdue";
  lifecycle_status?: "draft" | "in_progress" | "waiting_payment" | "waiting_receipt" | "completed" | "cancelled";
  overall_progress_pct?: number;
  order_progress_pct?: number;
  receipt_progress_pct?: number;
  gross_payable_amount?: number;
  return_credit_amount?: number;
  reject_credit_amount?: number;
  qc_progress_pct?: number;
  return_progress_pct?: number;
  fulfillment_progress_pct?: number;
  total_qty_received_grn?: number;
  total_qty_qc_posted?: number;
  total_qty_returned?: number;
  active_delivery_id?: string | null;
  active_delivery_number?: string | null;
  active_delivery_status?: string | null;
}

export interface PurchaseOrderPaymentTerm {
  id: string;
  purchase_order_id: string;
  supplier_id: string;
  term_no: number;
  description: string | null;
  due_date: string;
  amount: number;
  paid_amount: number;
  status: "unpaid" | "partial" | "paid" | "overdue" | "cancelled";
  notes?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface VendorPayment {
  id: string;
  payment_number: string;
  purchase_order_id: string;
  payment_term_id?: string | null;
  supplier_id: string;
  payment_date: string;
  amount: number;
  method: "cash" | "bank_transfer" | "giro" | "qris" | "other";
  reference_number?: string | null;
  notes?: string | null;
  /** Arsip nota hasil scan (EPIC-018 Fase B): path di storage/private + nama asli. */
  receipt_path?: string | null;
  receipt_name?: string | null;
  status: "draft" | "posted" | "void";
  created_at: string;
  updated_at: string;
}

// ============================================
// PURCHASE RETURN TYPES
// ============================================

export type ReturnReasonType = 
  | 'damaged'
  | 'wrong_item'
  | 'expired'
  | 'overstock'
  | 'specification_mismatch'
  | 'other';

export type ReturnStatus = 
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'completed'
  | 'cancelled';

export type QCStatus = 'rejected' | 'partially_rejected';

export interface PurchaseReturn {
  id: string;
  return_number: string;
  grn_id: string | null;
  grn_number?: string | null;
  supplier_id: string;
  vendor_id?: string | null;
  return_date: string;
  reason_type: ReturnReasonType;
  reason_notes: string | null;
  status: ReturnStatus;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  total_amount: number;
  shipping_date: string | null;
  tracking_number: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  
  // Relations (optional, loaded separately)
  supplier?: { nama_supplier: string };
  vendor?: { name?: string | null };
  grn?: { id?: string | null; grn_number?: string | null; nomor_grn?: string | null };
  items?: PurchaseReturnItem[];
}

export interface PurchaseReturnItem {
  id: string;
  return_id: string;
  grn_item_id: string | null;
  raw_material_id: string;
  qty_returned: number;
  unit_cost: number;
  subtotal: number;
  batch_number: string | null;
  expiry_date: string | null;
  condition_notes: string | null;
  qc_status: QCStatus;
  created_at: string;
  
  // Relations (optional)
  raw_material?: {
    kode: string;
    nama: string;
    satuan?: string;
  };
  grn_item?: {
    warehouse_id?: string | null;
    warehouse?: { name?: string | null } | null;
  };
}

export interface ReturnableItem {
  grn_item_id: string;
  grn_id: string;
  raw_material_id: string;
  product_id?: string;
  product_kode?: string;
  product_nama?: string;
  raw_material_kode: string;
  raw_material_nama: string;
  qty_diterima: number;
  qty_returned: number;
  qty_available_to_return: number;
  unit_price: number;
  batch_number: string | null;
  expiry_date: string | null;
  qc_status: string;
  supplier_id: string;
  vendor_id?: string;
  nama_supplier: string;
  satuan?: string;
  warehouse_id?: string | null;
  warehouse_name?: string;
}

export interface PurchaseReturnFormData {
  grn_id: string;
  supplier_id?: string;
  vendor_id?: string;
  module_type?: "raw_material" | "product" | "general";
  return_date: string;
  reason_type: ReturnReasonType;
  reason_notes: string;
  items: Array<{
    grn_item_id: string;
    raw_material_id?: string;
    product_id?: string;
    qty_returned: number;
    unit_cost: number;
    batch_number?: string | null;
    expiry_date?: string | null;
    condition_notes?: string;
  }>;
  notes?: string;
}

export interface ReturnListParams {
  page?: number;
  limit?: number;
  supplier_id?: string;
  vendor_id?: string;
  module_type?: "raw_material" | "product" | "general";
  status?: ReturnStatus | 'all';
  reason_type?: ReturnReasonType | 'all';
  date_from?: string;
  date_to?: string;
  search?: string;
  sort_by?: 'return_date' | 'created_at' | 'return_number';
  sort_order?: 'ASC' | 'DESC';
}

export interface ReturnSummary {
  total_returns: number;
  total_amount: number;
  by_status: Record<ReturnStatus, number>;
  by_reason: Record<ReturnReasonType, number>;
  top_suppliers: Array<{
    supplier_id: string;
    supplier_name: string;
    return_count: number;
    total_amount: number;
  }>;
}

// Reason type labels for UI
export const RETURN_REASON_LABELS: Record<ReturnReasonType, string> = {
  damaged: 'Barang Rusak',
  wrong_item: 'Barang Salah',
  expired: 'Kedaluwarsa',
  overstock: 'Kelebihan Stok',
  specification_mismatch: 'Tidak Sesuai Spesifikasi',
  other: 'Lainnya',
};

// Status labels for UI
export const RETURN_STATUS_LABELS: Record<ReturnStatus, string> = {
  draft: 'Draf',
  pending_approval: 'Menunggu Persetujuan',
  approved: 'Disetujui',
  rejected: 'Ditolak',
  completed: 'Selesai',
  cancelled: 'Dibatalkan',
};

// Status colors for UI badges
export const RETURN_STATUS_COLORS: Record<ReturnStatus, string> = {
  draft: 'bg-gray-100 text-gray-800',
  pending_approval: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
  completed: 'bg-blue-100 text-blue-800',
  cancelled: 'bg-gray-100 text-gray-600',
};
