import type { CashFlowCategory } from "@/lib/accounting/coa-types";

export interface CoaAccountItem {
  id: string;
  company_id: string | null;
  code: string;
  code_display: string;
  name: string;
  parent_id: string | null;
  account_type_id: string;
  account_type_code: string | null;
  account_type_name: string | null;
  normal_balance: string | null;
  level: number;
  is_postable: boolean;
  is_contra: boolean;
  is_cash_bank: boolean;
  cash_flow_category: CashFlowCategory | null;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at?: string | null;
}

export interface CoaAccountPayload {
  code: string;
  name: string;
  parent_id?: string | null;
  account_type_id: string;
  is_contra?: boolean;
  is_cash_bank?: boolean;
  cash_flow_category?: CashFlowCategory | null;
  description?: string | null;
  is_active?: boolean;
}

export interface CoaListFilters {
  search?: string;
  account_type_id?: string;
  is_postable?: string;
  is_contra?: string;
  is_cash_bank?: string;
  cash_flow_category?: string;
  is_active?: string;
}

export interface CoaImportPreviewRow {
  source_row: number;
  code: string;
  name: string;
  parent_code: string | null;
  account_type_code: string;
  action: "create" | "update" | "skip" | "error";
  message?: string;
}

export interface CoaImportResult {
  mode: string;
  issues: Array<{ row: number; code?: string; message: string }>;
  preview: CoaImportPreviewRow[];
  summary: { create: number; update: number; skip: number; error: number };
}
