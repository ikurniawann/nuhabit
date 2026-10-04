export type LeadOrgType =
  | "corporate"
  | "sekolah"
  | "komunitas"
  | "travel-agent"
  | "pemerintah"
  | "perorangan"
  | "lainnya";

export type LeadSource =
  | "wa"
  | "instagram"
  | "referral"
  | "google"
  | "pameran"
  | "canvassing"
  | "lainnya";

export type LeadTemperature = "panas" | "hangat" | "dingin";

export type LeadStatus = "baru" | "dihubungi" | "qualified" | "tidak-cocok";

export interface SalesLead {
  id: string;
  company_id: string;
  branch_id: string;
  org_name: string;
  org_type: LeadOrgType;
  pic_name: string;
  pic_title: string | null;
  pic_phone: string;
  pic_email: string | null;
  city: string | null;
  source: LeadSource;
  temperature: LeadTemperature;
  status: LeadStatus;
  notes: string | null;
  owner_user_id: string | null;
  owner_name: string | null;
  customer_id: string | null;
  account_id?: string | null;
  contact_id?: string | null;
  account_name?: string | null;
  custom?: Record<string, unknown>;
  score?: number;
  score_breakdown?: Array<{ rule_id: string; name: string; points: number; count?: number }>;
  score_updated_at?: string | null;
  /** Atribusi dari form publik / tautan iklan (EPIC-050 T-5.2). */
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_content?: string | null;
  utm_term?: string | null;
  landing_page?: string | null;
  referrer?: string | null;
  created_at: string;
  updated_at: string;
}

export interface LeadFilters {
  q: string;
  status: string;
  org_type: string;
  source: string;
  page: number;
  sort?: "score" | "newest";
}

export interface LeadFormValues {
  org_name: string;
  org_type: LeadOrgType;
  pic_name: string;
  pic_title: string;
  pic_phone: string;
  pic_email: string;
  city: string;
  source: LeadSource;
  temperature: LeadTemperature;
  status: LeadStatus;
  notes: string;
  custom?: Record<string, unknown>;
}

export interface LeadListResponse {
  success: boolean;
  data: SalesLead[];
  pagination: { page: number; limit: number; total: number; totalPages?: number };
}

export const ORG_TYPE_LABELS: Record<LeadOrgType, string> = {
  corporate: "Corporate",
  sekolah: "Sekolah",
  komunitas: "Komunitas",
  "travel-agent": "Travel Agent",
  pemerintah: "Pemerintah",
  perorangan: "Perorangan",
  lainnya: "Lainnya",
};

export const SOURCE_LABELS: Record<LeadSource, string> = {
  wa: "WhatsApp",
  instagram: "Instagram",
  referral: "Referral",
  google: "Google",
  pameran: "Pameran",
  canvassing: "Canvassing",
  lainnya: "Lainnya",
};

export const TEMPERATURE_LABELS: Record<LeadTemperature, string> = {
  panas: "Panas",
  hangat: "Hangat",
  dingin: "Dingin",
};

export const STATUS_LABELS: Record<LeadStatus, string> = {
  baru: "Baru",
  dihubungi: "Dihubungi",
  qualified: "Qualified",
  "tidak-cocok": "Tidak Cocok",
};

// ── Detail 360° (Fase D) ──

export interface LeadDealSummary {
  id: string;
  title: string;
  event_type: string;
  event_date: string | null;
  is_event_date_fixed: boolean;
  pax_estimate: number | null;
  value_estimate: string | null;
  value_final: string | null;
  closed_at: string | null;
  created_at: string;
  stage_name: string;
  stage_code: string;
  is_won: boolean;
  is_lost: boolean;
  lost_reason_name: string | null;
}

export interface LeadActivitySummary {
  id: string;
  deal_id: string | null;
  activity_type: string;
  notes: string | null;
  due_at: string | null;
  done_at: string | null;
  created_at: string;
  owner_name: string | null;
  deal_title: string | null;
}

export interface LinkedCustomer {
  id: string;
  name: string | null;
  phone: string | null;
  membership_tier: string | null;
  total_xp: string | number | null;
  ark_coin_balance: string | number | null;
  total_spent: string | number | null;
  visit_count: string | number | null;
  last_visit: string | null;
  is_active: boolean;
}

export interface CustomerOrderSummary {
  id: string;
  total_amount: string | number | null;
  status: string | null;
  payment_status: string | null;
  created_at: string;
}

/** Normalisasi nomor WA sisi klien — cermin normalizePhone server (62…). */
export function normalizePhoneClient(raw: string): string {
  const digits = raw.replace(/[^0-9]/g, "");
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  if (digits.startsWith("8")) return `62${digits}`;
  return digits;
}

export interface PicLookupResult {
  pic: { name: string; title: string | null; email: string | null };
  leads: Array<{ id: string; org_name: string; status: string }>;
}

export interface CustomerSearchResult {
  id: string;
  name: string | null;
  phone: string | null;
  membership_tier: string | null;
}

export interface LeadDetail {
  lead: SalesLead & { branch_name: string | null };
  deals: LeadDealSummary[];
  activities: LeadActivitySummary[];
  customer: LinkedCustomer | null;
  recent_orders: CustomerOrderSummary[];
}

export const EMPTY_LEAD_FORM: LeadFormValues = {
  org_name: "",
  org_type: "corporate",
  pic_name: "",
  pic_title: "",
  pic_phone: "",
  pic_email: "",
  city: "",
  source: "lainnya",
  temperature: "hangat",
  status: "baru",
  notes: "",
};
