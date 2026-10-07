export type PassEntryPolicy = "once_per_day" | "unlimited" | "limited_visits";

export type PassStatus =
  | "pending"
  | "active"
  | "expired"
  | "suspended"
  | "cancelled";

export interface PassOption {
  ticket_product_id: string;
  name: string;
  validity_months: number;
  entry_policy: PassEntryPolicy;
  visit_quota: number | null;
  unit_price: number;
}

export interface IssuedPassRow {
  id: string;
  pass_code: string;
  holder_name: string;
  holder_phone: string | null;
  product_name: string;
  status: PassStatus;
  entry_policy: PassEntryPolicy;
  valid_from: string | null;
  valid_until: string | null;
  visit_quota_total: number | null;
  visit_quota_used: number;
  band_uid: string | null;
  unit_price: number;
  created_at: string;
}

export interface IssuePassValues {
  ticket_product_id: string;
  holder_name: string;
  holder_phone?: string | null;
  band_uid?: string | null;
}

export interface IssuedPassResult {
  id: string;
  pass_code: string;
  access_token: string;
  holder_name: string;
  valid_from: string;
  valid_until: string;
  entry_policy: PassEntryPolicy;
  visit_quota_total: number | null;
  unit_price: number;
  band_uid: string | null;
}

export interface PassGateResult {
  ok: boolean;
  result:
    | "granted"
    | "denied_expired"
    | "denied_duplicate"
    | "denied_quota"
    | "denied_inactive"
    | "denied_blackout"
    | "bukan-pass";
  reason?: string;
  holder_name?: string;
  pass_code?: string;
  ticket_type_name?: string;
  valid_until?: string | null;
  entry_policy?: PassEntryPolicy;
  remaining_quota?: number;
}

export const ENTRY_POLICY_LABEL: Record<PassEntryPolicy, string> = {
  once_per_day: "1× per hari",
  unlimited: "Tak terbatas",
  limited_visits: "Jatah kunjungan",
};
