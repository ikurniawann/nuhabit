/**
 * Logika murni Membership (EPIC-069) — tier loyalitas dari spending 12 bulan
 * berjalan. Query ada di membership-server.ts.
 *
 * Aturan:
 *  - naik tier langsung saat spending 12 bulan mencapai ambang;
 *  - tier berlaku sampai 12 bulan sejak terakhir kali member memenuhi ambangnya
 *    (`valid_until`), jadi belanja yang "keluar jendela" tidak langsung
 *    menurunkan tier;
 *  - setelah masa berlaku habis dan spending di bawah ambang, turun langsung ke
 *    tier yang sesuai spending saat itu (atau tanpa tier).
 */

import { NO_BENEFITS, type TierBenefits } from "@/lib/studio/loyalty";

export interface MembershipTier {
  id: string;
  name: string;
  min_spend: number;
  display_color: string | null;
  /** Diskon F&B/POS & self-order meja. */
  discount_percent: number;
  early_booking_days: number;
  cancel_window_hours: number | null;
  waitlist_priority: boolean;
  /** Perks lain (teks) — dipenuhi staf. */
  perks: string[];
}

export interface MembershipState {
  tier_id: string | null;
  valid_until: string | null;
}

export interface MembershipEvaluation {
  tier: MembershipTier | null;
  valid_until: string | null;
  change: { direction: "up" | "down"; from: MembershipTier | null; to: MembershipTier | null } | null;
}

/** Tanggal ISO + 1 tahun (29 Feb → 1 Mar). */
export function addOneYear(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

export function sortTiers(tiers: MembershipTier[]): MembershipTier[] {
  return [...tiers].sort((a, b) => a.min_spend - b.min_spend);
}

/** Tier tertinggi yang ambangnya tercapai (null bila di bawah tier terendah / belum ada tier). */
export function earnedTier(tiers: MembershipTier[], spend: number): MembershipTier | null {
  return [...sortTiers(tiers)].reverse().find((t) => spend >= t.min_spend) ?? null;
}

export function evaluateMembership(tiers: MembershipTier[], spend: number, state: MembershipState | null, today: string): MembershipEvaluation {
  const earned = earnedTier(tiers, spend);
  // Tier tersimpan yang sudah dinonaktifkan/dihapus dianggap tidak ada.
  const current = state?.tier_id ? (tiers.find((t) => t.id === state.tier_id) ?? null) : null;

  if (earned && (!current || earned.min_spend >= current.min_spend)) {
    return {
      tier: earned,
      valid_until: addOneYear(today),
      change: earned.id === current?.id ? null : { direction: "up", from: current, to: earned },
    };
  }
  if (!current) return { tier: null, valid_until: null, change: null };
  if (state?.valid_until && today <= state.valid_until) {
    return { tier: current, valid_until: state.valid_until, change: null };
  }
  return {
    tier: earned,
    valid_until: earned ? addOneYear(today) : null,
    change: { direction: "down", from: current, to: earned },
  };
}

/** Tier berikutnya di atas tier saat ini + sisa spending untuk mencapainya. */
export function nextTier(tiers: MembershipTier[], current: MembershipTier | null, spend: number) {
  const next = sortTiers(tiers).find((t) => t.min_spend > (current?.min_spend ?? -1)) ?? null;
  return next ? { tier: next, spend_needed: Math.max(next.min_spend - spend, 0) } : null;
}

/** Sisa spending agar tier saat ini bertahan setelah masa berlakunya (null bila sudah aman). */
export function keepTier(current: MembershipTier | null, spend: number, validUntil: string | null) {
  if (!current || spend >= current.min_spend) return null;
  return { spend_needed: current.min_spend - spend, by: validUntil };
}

export function membershipBenefits(tier: MembershipTier | null, frozen: boolean): TierBenefits & { discount_percent: number } {
  if (!tier || frozen) return { ...NO_BENEFITS, discount_percent: 0 };
  return {
    early_booking_days: tier.early_booking_days,
    cancel_window_hours: tier.cancel_window_hours,
    waitlist_priority: tier.waitlist_priority,
    discount_percent: Math.min(100, Math.max(0, tier.discount_percent)),
  };
}

/** Tanggal mulai jendela 12 bulan (365 hari, inklusif hari ini). */
export function windowStart(today: string): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 364);
  return d.toISOString().slice(0, 10);
}

/** Rapikan daftar perks dari input backoffice: trim, buang kosong & duplikat. */
export function cleanPerks(perks: string[]): string[] {
  const out: string[] = [];
  for (const p of perks) {
    const v = p.trim().replace(/\s+/g, " ");
    if (v && !out.some((x) => x.toLowerCase() === v.toLowerCase())) out.push(v);
  }
  return out;
}
