/**
 * Tier member dari lifetime XP (level Progress) + diskon self-order meja.
 * Portal member (/me) dan order meja sama-sama memakai
 * loadMemberDiscountPercent, supaya harga coret yang dilihat member ==
 * potongan yang disimpan server.
 */

import { memberMembershipDiscount } from "@/lib/studio/membership-server";

export type MembershipTierRow = {
  code: string;
  name: string;
  min_lifetime_xp: number;
  discount_percent: number;
};

/** `tiers` urut rank naik. XP di bawah tier pertama tetap dapat tier pertama. */
export function resolveTierByXp<T extends { min_lifetime_xp: number | string }>(
  tiers: T[],
  totalXp: number
): T | null {
  return [...tiers].reverse().find((tier) => totalXp >= Number(tier.min_lifetime_xp)) ?? tiers[0] ?? null;
}

/**
 * Persen diskon F&B member (0 bila tak ada). Sejak EPIC-069 dari tier
 * Membership (spending 12 bulan), bukan tier XP.
 */
export async function loadMemberDiscountPercent(customerId: string): Promise<number> {
  return memberMembershipDiscount(customerId);
}
