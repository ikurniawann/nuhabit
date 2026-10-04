export type ProductPRListItem = {
  id: string;
  pr_number: string;
  requester_id: string;
  requester_name?: string;
  department_id: string;
  department_name?: string;
  status: string;
  total_amount: number;
  priority: string;
  notes: string | null;
  required_date: string | null;
  created_at: string;
  module_type?: string;
};

export type ProductPRStatusFilter =
  | "all"
  | "draft"
  | "pending_head"
  | "pending_finance"
  | "pending_direksi"
  | "approved"
  | "rejected"
  | "converted";

export interface ProductPRListParams {
  page?: number;
  limit?: number;
  status?: string;
  search?: string;
}

export interface ProductPRListResult {
  data: ProductPRListItem[];
  total: number;
}

export interface ProductPRFormItemInput {
  product_id: string;
  satuan_id?: string;
  description: string;
  qty: number;
  unit: string;
  estimated_price: number;
}

export interface ProductPRFormInput {
  department_id: string;
  priority: "low" | "medium" | "high" | "urgent";
  required_date?: string;
  notes?: string;
  items: ProductPRFormItemInput[];
}

export interface ProductPRFormPayload extends ProductPRFormInput {
  action?: "draft" | "submit";
  module_type?: "product";
}

export interface ProductPRFormProduct {
  id: string;
  kode: string;
  nama: string;
  satuan_id?: string | null;
  satuan_nama?: string | null;
  harga_modal?: number | null;
}

export interface ProductPRFormData {
  departments: { id: string; name: string }[];
  products: ProductPRFormProduct[];
  units: { id: string; nama: string }[];
}

export interface ProductPRDetailPermissions {
  canEdit: boolean;
  canApprove: boolean;
  canCreatePO: boolean;
}

export interface ProductPRDetailItem {
  id: string;
  product_id?: string | null;
  satuan_id?: string | null;
  description?: string | null;
  qty?: number | null;
  unit?: string | null;
  estimated_price?: number | null;
  total?: number | null;
  product?: { id: string; kode: string; nama: string } | null;
  satuan?: { id: string; nama: string } | null;
}

export interface ProductPRDetail extends ProductPRListItem {
  converted_po_id?: string | null;
  approved_by_head?: string | null;
  approved_by_finance?: string | null;
  approved_by_direksi?: string | null;
  rejected_by?: string | null;
  approved_at_head?: string | null;
  approved_at_finance?: string | null;
  approved_at_direksi?: string | null;
  rejected_at?: string | null;
  rejection_reason?: string | null;
  current_approval_level?: string | null;
  items?: ProductPRDetailItem[];
  department?: { name: string; code?: string } | null;
  requester_name?: string;
  approved_head_name?: string | null;
  approved_finance_name?: string | null;
  approved_direksi_name?: string | null;
  rejected_by_name?: string | null;
  permissions: ProductPRDetailPermissions;
}
