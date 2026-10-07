export interface PRListItem {
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
  converted_po_id?: string | null;
}

export type PRStatusFilter =
  | "all"
  | "draft"
  | "pending_head"
  | "pending_finance"
  | "pending_direksi"
  | "approved"
  | "rejected"
  | "converted";

export interface PRListParams {
  page?: number;
  limit?: number;
  status?: string;
  search?: string;
}

export interface PRListResult {
  data: PRListItem[];
  total: number;
}

export interface PRFormItemInput {
  raw_material_id: string;
  satuan_id?: string;
  description: string;
  qty: number;
  unit: string;
  estimated_price: number;
}

export interface PRFormInput {
  department_id: string;
  priority: "low" | "medium" | "high" | "urgent";
  required_date?: string;
  notes?: string;
  items: PRFormItemInput[];
}

export interface PRFormPayload extends PRFormInput {
  action?: "draft" | "submit";
}

export interface PRFormMaterial {
  id: string;
  kode: string;
  nama: string;
  satuan_besar_id?: string;
  satuan_besar_nama?: string;
  satuan_kecil_id?: string | null;
  konversi_factor?: number | null;
  avg_cost?: number;
  unit_conversions?: {
    satuan_id: string;
    qty_in_base_unit: number;
    is_base?: boolean;
    is_purchase_default?: boolean;
    is_active?: boolean;
  }[];
}

export interface PRFormData {
  departments: { id: string; name: string }[];
  materials: PRFormMaterial[];
  units: { id: string; nama: string }[];
}

export interface PRDetailPermissions {
  canEdit: boolean;
  canApprove: boolean;
  canCreatePO: boolean;
}

export interface PRDetailItem {
  id: string;
  raw_material_id?: string | null;
  satuan_id?: string | null;
  description?: string | null;
  qty?: number | null;
  unit?: string | null;
  estimated_price?: number | null;
  total?: number | null;
  raw_material?: { id: string; kode: string; nama: string } | null;
  satuan?: { id: string; nama: string } | null;
}

export interface PRDetail extends PRListItem {
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
  items?: PRDetailItem[];
  department?: { name: string; code?: string } | null;
  requester_name?: string;
  approved_head_name?: string | null;
  approved_finance_name?: string | null;
  approved_direksi_name?: string | null;
  rejected_by_name?: string | null;
  permissions: PRDetailPermissions;
}
