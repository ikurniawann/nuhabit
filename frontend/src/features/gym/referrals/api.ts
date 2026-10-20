/** Klien API Gym → Referral: pengaturan program, daftar referral, leaderboard. */
import { call, send } from "../shared";

export type ReferralStatus = "joined" | "held" | "rewarded" | "capped" | "void" | "blocked";

export interface ReferralSettings {
  is_active: boolean;
  referrer_credits: number;
  referrer_ark_idr: number;
  referee_credits: number;
  referee_campaign_id: string | null;
  credit_validity_days: number;
  hold_days: number;
  monthly_cap: number;
}

export interface PromoCampaign {
  id: string;
  name: string;
  discount_type: "percent" | "fixed";
  value: number;
  max_discount: number | null;
  scope: string;
  is_active: boolean;
}

export interface SettingsView {
  settings: ReferralSettings;
  campaigns: PromoCampaign[];
}

interface PersonRef {
  id: string;
  name: string;
  phone: string;
}

export interface ReferralRow {
  id: string;
  status: ReferralStatus;
  reason: string | null;
  code: string;
  referrer: PersonRef;
  referee: PersonRef;
  purchase_id: string | null;
  purchase_total_idr: number | null;
  created_at: string;
  qualified_at: string | null;
  hold_until: string | null;
  settled_at: string | null;
  referrer_credits: number;
  referrer_ark_idr: number;
  referee_credits: number;
  referee_voucher_code: string | null;
}

export interface ReferralPage {
  rows: ReferralRow[];
  total: number;
  counts: Record<ReferralStatus, number>;
}

export interface Leader extends PersonRef {
  invited: number;
  joined: number;
  rewarded: number;
  credits: number;
  ark_idr: number;
}

export const STATUS_LABELS: Record<ReferralStatus, string> = {
  joined: "Terdaftar",
  held: "Masa tahan",
  rewarded: "Dapat hadiah",
  capped: "Melewati batas bulanan",
  void: "Batal (refund)",
  blocked: "Diblokir",
};

export const REASON_LABELS: Record<string, string> = {
  self_referral: "Memakai kode sendiri",
  same_contact: "Nomor atau email sama dengan pengajak",
  same_device: "Perangkat sama",
  refunded: "Pembelian pertama direfund",
};

export const PAGE_SIZE = 25;

/** Query string of the list: empty filters are left out. */
export function listQuery(status: string, search: string, page: number): string {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (search.trim()) params.set("q", search.trim());
  params.set("limit", String(PAGE_SIZE));
  params.set("offset", String(page * PAGE_SIZE));
  return params.toString();
}

/** "Diskon 20%" or "Diskon Rp50.000", with the cap of a percent discount. */
export function campaignLabel(c: PromoCampaign, formatRupiah: (n: number) => string): string {
  const amount = c.discount_type === "percent" ? `${c.value}%` : formatRupiah(c.value);
  const cap = c.discount_type === "percent" && c.max_discount ? `, maks. ${formatRupiah(c.max_discount)}` : "";
  return `${c.name} (diskon ${amount}${cap})${c.is_active ? "" : " · nonaktif"}`;
}

export const REFERRAL_KEYS = {
  settings: ["gym-referrals", "settings"] as const,
  list: (query: string) => ["gym-referrals", "list", query] as const,
  leaderboard: (month: string) => ["gym-referrals", "leaderboard", month] as const,
};

export const referralsApi = {
  settings: () => call<SettingsView>("/api/gym/referrals/settings"),
  saveSettings: (s: ReferralSettings) => send<SettingsView>("/api/gym/referrals/settings", s, "PUT"),
  list: (query: string) => call<ReferralPage>(`/api/gym/referrals?${query}`),
  leaderboard: (month: string) => call<Leader[]>(`/api/gym/referrals/leaderboard?month=${encodeURIComponent(month)}`),
};
