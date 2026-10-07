/** Klien API tab aktivitas, badge, XP, dan persetujuan di detail member. */

import type { BadgeMetric } from "@/lib/crm/badges";
import { crmFetch as call } from "../crm-fetch";

export interface MemberCheckin {
  id: string;
  decision: "accepted" | "denied";
  reason: "not_found" | "expired" | "consumed" | null;
  created_at: string;
  cashier_name: string | null;
}

export interface MemberBooking {
  id: string;
  status: "confirmed" | "waitlist" | "cancelled" | "attended" | "no_show";
  waitlist_position: number | null;
  late_cancel: boolean;
  created_at: string;
  title: string;
  starts_at: string;
  location: string | null;
  price_idr: number;
}

export interface MemberChallengeJoin {
  id: string;
  title: string;
  metric: "visits" | "spend";
  target: number;
  starts_at: string;
  ends_at: string;
  reward_xp: number;
  reward_ark_idr: number;
  joined_at: string;
  rewarded_at: string | null;
}

export interface MemberNotificationRow {
  id: string;
  type: string;
  title: string;
  body: string;
  created_at: string;
  read_at: string | null;
  opened_at: string | null;
  clicked_at: string | null;
  campaign_name: string | null;
}

export interface MemberWalletRow {
  id: string;
  type: string;
  amount: number;
  ark_coins: number | null;
  balance_after: number | null;
  status: string;
  notes: string | null;
  payment_method: string | null;
  created_at: string;
}

export interface MemberBadgeRow {
  id: string;
  code: string;
  name: string;
  image_url: string | null;
  metric: BadgeMetric;
  threshold: number | null;
  min_lifetime_xp: number;
  bonus_xp: number;
  is_active: boolean;
  awarded_at: string | null;
  source: "auto" | "manual" | null;
  revoked_at: string | null;
  revoke_reason: string | null;
}

export interface MemberConsent {
  wa_consent: boolean;
  wa_verified_at: string | null;
  marketing_opt_out: boolean;
  optout_source: "manual" | "keyword" | null;
  optout_note: string | null;
  optout_at: string | null;
}

export interface MemberActivity {
  checkins: MemberCheckin;
  bookings: MemberBooking;
  challenges: MemberChallengeJoin;
  notifications: MemberNotificationRow;
  wallet: MemberWalletRow;
}

const base = (customerId: string) => `/api/crm/members/${customerId}`;

export const memberEngagementApi = {
  activity: <K extends keyof MemberActivity>(customerId: string, tab: K) =>
    call<MemberActivity[K][]>(`${base(customerId)}/activity?tab=${tab}`).then((r) => r.data),
  badges: (customerId: string) => call<MemberBadgeRow[]>(`${base(customerId)}/badges`).then((r) => r.data),
  changeBadge: (customerId: string, input: { badge_id: string; action: "award" | "revoke"; reason?: string }) =>
    call<{ awarded?: boolean; revoked?: boolean }>(`${base(customerId)}/badges`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  adjustXp: (customerId: string, input: { delta: number; reason: string; request_id: string }) =>
    call<{ status: string; xpDelta: number; totalXp: number }>(`${base(customerId)}/xp-adjust`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  consent: (customerId: string) => call<MemberConsent>(`${base(customerId)}/consent`).then((r) => r.data),
  saveConsent: (customerId: string, input: { wa_consent?: boolean; marketing_opt_out?: boolean }) =>
    call<MemberConsent>(`${base(customerId)}/consent`, { method: "PUT", body: JSON.stringify(input) }),
};
