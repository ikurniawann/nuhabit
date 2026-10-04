export interface SalesContact {
  id: string;
  company_id: string;
  branch_id: string;
  account_id: string | null;
  account_name: string | null;
  account_type: string | null;
  name: string;
  title: string | null;
  phone: string;
  email: string | null;
  is_primary: boolean;
  customer_id: string | null;
  notes: string | null;
  owner_user_id: string | null;
  owner_name: string | null;
  custom: Record<string, unknown>;
  lead_count?: number;
  last_activity_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContactFilters {
  q: string;
  account_id: string;
  page: number;
}

export interface ContactFormValues {
  account_id: string;
  name: string;
  title: string;
  phone: string;
  email: string;
  is_primary: boolean;
  notes: string;
  custom?: Record<string, unknown>;
}

export const EMPTY_CONTACT_FORM: ContactFormValues = {
  account_id: "",
  name: "",
  title: "",
  phone: "",
  email: "",
  is_primary: false,
  notes: "",
};

export interface ContactListResponse {
  success: boolean;
  data: SalesContact[];
  pagination: { page: number; limit: number; total: number; totalPages?: number };
}

export function contactToForm(contact: SalesContact): ContactFormValues {
  return {
    account_id: contact.account_id ?? "",
    name: contact.name,
    title: contact.title ?? "",
    phone: contact.phone,
    email: contact.email ?? "",
    is_primary: contact.is_primary,
    notes: contact.notes ?? "",
    custom: contact.custom ?? {},
  };
}
