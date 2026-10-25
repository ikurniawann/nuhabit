/** Klien API Gym → Membership & Progres: tier dari belanja, pengaturan XP, status member, leaderboard. */
import { call, remove, send } from "../shared";

export type MemberStatus = "active" | "suspended" | "banned";

export interface MembershipTier {
  id: string;
  name: string;
  color: string | null;
  min_spend_idr: number;
  discount_percent: number;
  early_booking_days: number;
  cancel_window_hours: number | null;
  waitlist_priority: boolean;
  perks: string[];
}

export interface TierRow extends MembershipTier {
  rank: number;
  members: number;
}

export interface LoyaltySettings {
  tier_hold_months: number;
  xp_class_attended: number;
  xp_pt_attended: number;
  xp_offpeak_bonus: number;
  xp_weekly_streak: number;
  weekly_streak_min_sessions: number;
  xp_streak_4w: number;
  xp_purchase_per_step: number;
  purchase_step_idr: number;
  xp_early_renewal: number;
}

export interface OffPeak {
  starts_min: number;
  ends_min: number;
}

export interface BranchOffPeak {
  branch_id: string;
  branch_name: string;
  timezone: string;
  offpeak: OffPeak | null;
}

export interface TiersView {
  tiers: TierRow[];
  settings: LoyaltySettings;
  offpeak: BranchOffPeak[];
}

export type TierInput = Omit<MembershipTier, "id">;

export interface SettingsInput extends LoyaltySettings {
  offpeak: { branch_id: string; offpeak: OffPeak | null }[];
}

export interface Perks {
  discount_percent: number;
  early_booking_days: number;
  cancel_window_hours: number | null;
  waitlist_rank: number;
}

export interface Spend {
  total_idr: number;
  gym_idr: number;
  pos_idr: number;
  shop_idr: number;
  from: string;
  to: string;
}

export interface TierChange {
  direction: "up" | "down";
  from_tier_name: string | null;
  to_tier_name: string | null;
  spend_12m_idr: number;
  created_at: string;
}

export interface MembershipView {
  enabled: boolean;
  status: MemberStatus;
  frozen: boolean;
  tier: MembershipTier | null;
  valid_until: string | null;
  spend: Spend;
  next: { tier: MembershipTier; spend_needed_idr: number } | null;
  keep: { spend_needed_idr: number; by: string | null } | null;
  perks: Perks;
  tiers: MembershipTier[];
  history: TierChange[];
}

export interface Standing {
  status: MemberStatus;
  reason: string | null;
  suspended_until: string | null;
}

export interface StatusEvent {
  from_status: MemberStatus;
  to_status: MemberStatus;
  reason: string | null;
  suspended_until: string | null;
  changed_by_name: string | null;
  created_at: string;
}

export interface XPTier {
  code: string;
  name: string;
  min_lifetime_xp: number;
  discount_percent: number;
}

export interface MemberLoyalty {
  membership: MembershipView;
  xp: { lifetime_xp: number; tier: XPTier | null; next_tier: XPTier | null } | null;
  standing: Standing;
  status_history: StatusEvent[];
}

export interface StatusRow {
  customer_id: string;
  name: string | null;
  phone: string;
  status: MemberStatus;
  reason: string | null;
  suspended_until: string | null;
  changed_at: string | null;
  tier_name: string | null;
  spend_12m_idr: number;
}

export interface LeaderboardView {
  branch: { id: string; name: string } | null;
  branches: { id: string; name: string }[];
  month: string;
  entries: { rank: number; alias: string; sessions: number; tier_name: string | null; me: boolean }[];
}

export const STATUS_LABELS: Record<MemberStatus, string> = {
  active: "Aktif",
  suspended: "Ditangguhkan",
  banned: "Diblokir",
};

export const STATUS_HINTS: Record<MemberStatus, string> = {
  active: "Perks tier, XP dan leaderboard berlaku.",
  suspended: "Sampai tanggal yang dipilih, perks tier, XP dan leaderboard dibekukan. Booking dan gate tetap jalan.",
  banned: "Tidak bisa booking kelas atau masuk gate. Perks tier, XP dan leaderboard dibekukan.",
};

/** "06:30" from minutes after midnight. */
export function minutesToTime(min: number): string {
  const h = Math.floor(min / 60);
  return `${String(h).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

/** Minutes after midnight from "HH:MM"; "24:00" is the end of the day. null when invalid. */
export function timeToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (m > 59 || h > 24 || (h === 24 && m > 0)) return null;
  return h * 60 + m;
}

/** Perks the system applies, as short Indonesian lines. */
export function perkLines(t: Pick<MembershipTier, "discount_percent" | "early_booking_days" | "cancel_window_hours" | "waitlist_priority">): string[] {
  const lines: string[] = [];
  if (t.discount_percent > 0) lines.push(`Diskon POS & F&B ${t.discount_percent}%`);
  if (t.early_booking_days > 0) lines.push(`Booking dibuka ${t.early_booking_days} hari lebih awal`);
  if (t.cancel_window_hours !== null) lines.push(`Batal gratis sampai ${t.cancel_window_hours} jam sebelum kelas`);
  if (t.waitlist_priority) lines.push("Prioritas waitlist");
  return lines;
}

export const LOYALTY_KEYS = {
  tiers: ["gym-loyalty", "tiers"] as const,
  members: (q: string) => ["gym-loyalty", "members", q] as const,
  leaderboard: (branch: string, month: string) => ["gym-loyalty", "leaderboard", branch, month] as const,
  member: (id: string) => ["gym-loyalty", "member", id] as const,
};

export const loyaltyApi = {
  tiers: () => call<TiersView>("/api/gym/loyalty/tiers"),
  createTier: (t: TierInput) => send<MembershipTier>("/api/gym/loyalty/tiers", t),
  updateTier: (id: string, t: TierInput) => send<MembershipTier>(`/api/gym/loyalty/tiers/${id}`, t, "PATCH"),
  deleteTier: (id: string) => remove<{ id: string }>(`/api/gym/loyalty/tiers/${id}`),
  saveSettings: (s: SettingsInput) => send<TiersView>("/api/gym/loyalty/settings", s, "PUT"),
  recompute: () => send<{ changed: number }>("/api/gym/loyalty/recompute", {}),
  members: (q: string) => call<StatusRow[]>(`/api/gym/loyalty/members${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`),
  leaderboard: (branch: string, month: string) => {
    const params = new URLSearchParams();
    if (branch) params.set("branch_id", branch);
    if (month) params.set("month", month);
    return call<LeaderboardView>(`/api/gym/loyalty/leaderboard?${params.toString()}`);
  },
  member: (id: string) => call<MemberLoyalty>(`/api/gym/members/${id}/loyalty`),
  setStatus: (id: string, body: { status: MemberStatus; reason: string; suspended_until: string | null }) =>
    send<Standing>(`/api/gym/members/${id}/status`, body, "PUT"),
};
