import type { LeadOrgType } from "../leads/types";

export type AccountType = LeadOrgType;

export interface SalesAccount {
  id: string;
  company_id: string;
  branch_id: string;
  name: string;
  account_type: AccountType;
  industry: string | null;
  address: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  npwp: string | null;
  notes: string | null;
  owner_user_id: string | null;
  owner_name: string | null;
  custom: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  // agregat list
  contact_count?: number;
  lead_count?: number;
  open_deal_count?: number;
  won_value?: string | number | null;
  last_activity_at?: string | null;
  branch_name?: string | null;
}

export interface AccountFilters {
  q: string;
  account_type: string;
  city: string;
  page: number;
}

export interface AccountFormValues {
  name: string;
  account_type: AccountType;
  industry: string;
  address: string;
  city: string;
  phone: string;
  email: string;
  website: string;
  npwp: string;
  notes: string;
  custom?: Record<string, unknown>;
}

export const EMPTY_ACCOUNT_FORM: AccountFormValues = {
  name: "",
  account_type: "corporate",
  industry: "",
  address: "",
  city: "",
  phone: "",
  email: "",
  website: "",
  npwp: "",
  notes: "",
};

export interface AccountListResponse {
  success: boolean;
  data: SalesAccount[];
  pagination: { page: number; limit: number; total: number; totalPages?: number };
}

export interface AccountContactSummary {
  id: string;
  name: string;
  title: string | null;
  phone: string;
  email: string | null;
  is_primary: boolean;
  customer_id: string | null;
  owner_name: string | null;
  created_at: string;
}

export interface AccountLeadSummary {
  id: string;
  org_name: string;
  pic_name: string;
  pic_phone: string;
  source: string;
  temperature: string;
  status: string;
  owner_name: string | null;
  created_at: string;
}

export interface AccountDealSummary {
  id: string;
  lead_id: string;
  title: string;
  event_type: string;
  event_date: string | null;
  pax_estimate: number | null;
  value_estimate: string | null;
  value_final: string | null;
  closed_at: string | null;
  created_at: string;
  stage_name: string;
  stage_code: string;
  is_won: boolean;
  is_lost: boolean;
}

export interface AccountDetail {
  account: SalesAccount;
  contacts: AccountContactSummary[];
  leads: AccountLeadSummary[];
  deals: AccountDealSummary[];
  quotations: Array<{ id: string; deal_id: string; quote_number: string; status: string; total: string; valid_until: string | null; created_at: string }>;
  invoices: Array<{ id: string; deal_id: string; invoice_number: string; label: string | null; amount: string; due_date: string | null; status: string; created_at: string }>;
  tasks: Array<{ id: string; activity_type: string; title: string | null; notes: string | null; due_at: string | null; done_at: string | null; status: string; priority: string; owner_name: string | null; created_at: string }>;
}

export function accountToForm(account: SalesAccount): AccountFormValues {
  return {
    name: account.name,
    account_type: account.account_type,
    industry: account.industry ?? "",
    address: account.address ?? "",
    city: account.city ?? "",
    phone: account.phone ?? "",
    email: account.email ?? "",
    website: account.website ?? "",
    npwp: account.npwp ?? "",
    notes: account.notes ?? "",
    custom: account.custom ?? {},
  };
}
