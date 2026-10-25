"use client";

import { useQuery } from "@tanstack/react-query";
import { memberApi } from "./api";

/**
 * Membership (tier dari belanja 12 bulan), Progres (XP kehadiran, streak) dan
 * leaderboard kehadiran bulanan. Data mentah dari Go dipakai apa adanya.
 */
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

export interface MembershipView {
  enabled: boolean;
  status: MemberStatus;
  frozen: boolean;
  tier: MembershipTier | null;
  valid_until: string | null;
  spend: { total_idr: number; gym_idr: number; pos_idr: number; shop_idr: number; from: string; to: string };
  next: { tier: MembershipTier; spend_needed_idr: number } | null;
  keep: { spend_needed_idr: number; by: string | null } | null;
  perks: { discount_percent: number; early_booking_days: number; cancel_window_hours: number | null; waitlist_rank: number };
  tiers: MembershipTier[];
  history: { direction: "up" | "down"; from_tier_name: string | null; to_tier_name: string | null; created_at: string }[];
}

export interface ProgressRules {
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

export interface ProgressView {
  status: MemberStatus;
  frozen: boolean;
  xp: {
    lifetime_xp: number;
    tier: { code: string; name: string; min_lifetime_xp: number; discount_percent: number } | null;
    next_tier: { code: string; name: string; min_lifetime_xp: number; discount_percent: number } | null;
  };
  streak_weeks: number;
  week_sessions: number;
  month_sessions: number;
  rules: ProgressRules;
  history: { xp: number; source_type: string; description: string; created_at: string }[];
}

export interface LeaderboardView {
  branch: { id: string; name: string } | null;
  branches: { id: string; name: string }[];
  month: string;
  entries: { rank: number; alias: string; sessions: number; tier_name: string | null; me: boolean }[];
  me: { sessions: number; rank: number | null; visible: boolean; show_on_leaderboard: boolean } | null;
}

/** Perks a tier applies, as English dictionary keys with their numbers. */
export function tierPerkKeys(t: Pick<MembershipTier, "discount_percent" | "early_booking_days" | "cancel_window_hours" | "waitlist_priority">) {
  const out: { key: string; vars?: Record<string, number> }[] = [];
  if (t.discount_percent > 0) out.push({ key: "{n}% off at the café and POS", vars: { n: t.discount_percent } });
  if (t.early_booking_days > 0) out.push({ key: "Book classes {n} days earlier", vars: { n: t.early_booking_days } });
  if (t.cancel_window_hours !== null) out.push({ key: "Free cancel up to {n} hours before class", vars: { n: t.cancel_window_hours } });
  if (t.waitlist_priority) out.push({ key: "Priority on the waitlist" });
  return out;
}

/** Share of the way from the current tier's threshold to the next one, 0 to 100. */
export function spendProgressPct(view: Pick<MembershipView, "tier" | "next" | "spend">): number {
  if (!view.next) return 100;
  const floor = view.tier?.min_spend_idr ?? 0;
  const span = view.next.tier.min_spend_idr - floor;
  if (span <= 0) return 100;
  return Math.min(100, Math.max(0, ((view.spend.total_idr - floor) / span) * 100));
}

export const progressKeys = {
  membership: ["member-app", "membership"] as const,
  progress: ["member-app", "progress"] as const,
  leaderboard: (branch: string) => ["member-app", "leaderboard", branch] as const,
};

export const useMembership = () =>
  useQuery({ queryKey: progressKeys.membership, queryFn: () => memberApi<MembershipView>("/app/membership") });

export const useProgress = () =>
  useQuery({ queryKey: progressKeys.progress, queryFn: () => memberApi<ProgressView>("/app/progress") });

export const useLeaderboard = (branch: string) =>
  useQuery({
    queryKey: progressKeys.leaderboard(branch),
    queryFn: () => memberApi<LeaderboardView>(`/app/leaderboard${branch ? `?branch_id=${encodeURIComponent(branch)}` : ""}`),
  });
