// EPIC-026 B2b — tipe PR barang operasional (scope 'general'). Klon tipis dari
// product-pr: diskriminan item = `supply_item_id` (bukan `product_id`), sumber
// item form = `supplies` (item.supply_items), tanpa vendor price list.

export type GeneralPRListItem = {
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

export type GeneralPRStatusFilter =
  | "all"
  | "draft"
  | "pending_head"
  | "pending_finance"
  | "pending_direksi"
  | "approved"
  | "rejected"
  | "converted";

export interface GeneralPRListParams {
  page?: number;
  limit?: number;
  status?: string;
  search?: string;
}

export interface GeneralPRListResult {
  data: GeneralPRListItem[];
  total: number;
}

export interface GeneralPRFormItemInput {
  supply_item_id: string;
  satuan_id?: string;
  description: string;
  qty: number;
  unit: string;
  estimated_price: number;
}

export interface GeneralPRFormInput {
  department_id: string;
  priority: "low" | "medium" | "high" | "urgent";
  required_date?: string;
  notes?: string;
  items: GeneralPRFormItemInput[];
}

export interface GeneralPRFormPayload extends GeneralPRFormInput {
  action?: "draft" | "submit";
  module_type?: "general";
}

export interface GeneralPRFormSupply {
  id: string;
  kode: string;
  nama: string;
  satuan_id?: string | null;
  stockable?: boolean;
  harga_beli?: number | null;
}

export interface GeneralPRFormData {
  departments: { id: string; name: string }[];
  supplies: GeneralPRFormSupply[];
  units: { id: string; nama: string }[];
}

export interface GeneralPRDetailPermissions {
  canEdit: boolean;
  canApprove: boolean;
  canCreatePO: boolean;
}

export interface GeneralPRDetailItem {
  id: string;
  supply_item_id?: string | null;
  satuan_id?: string | null;
  description?: string | null;
  qty?: number | null;
  unit?: string | null;
  estimated_price?: number | null;
  total?: number | null;
  supply_item?: { id: string; kode: string; nama: string } | null;
  satuan?: { id: string; nama: string } | null;
}

export interface GeneralPRDetail extends GeneralPRListItem {
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
  items?: GeneralPRDetailItem[];
  department?: { name: string; code?: string } | null;
  requester_name?: string;
  approved_head_name?: string | null;
  approved_finance_name?: string | null;
  approved_direksi_name?: string | null;
  rejected_by_name?: string | null;
  permissions: GeneralPRDetailPermissions;
}
