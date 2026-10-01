/**
 * Tier member dari lifetime XP — satu sumber utk portal member (/me) dan
 * diskon self-order meja, supaya harga coret yang dilihat member == potongan
 * yang disimpan server.
 */

import { query } from "@/lib/db";

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

/** Persen diskon tier member (0 bila tak ada tier/schema CRM). Dibatasi 0–100. */
export async function loadMemberDiscountPercent(customerId: string): Promise<number> {
  try {
    const [customers, tiers] = await Promise.all([
      query<{ total_xp: number }>(
        `SELECT total_xp::float AS total_xp FROM pos.pos_customers WHERE id = $1`,
        [customerId]
      ),
      query<MembershipTierRow>(
        `SELECT code, name, min_lifetime_xp::float AS min_lifetime_xp,
                discount_percent::float AS discount_percent
         FROM crm.crm_membership_tiers WHERE is_active ORDER BY rank`,
        []
      ),
    ]);
    if (!customers[0]) return 0;
    const tier = resolveTierByXp(tiers, Number(customers[0].total_xp) || 0);
    return Math.min(100, Math.max(0, Number(tier?.discount_percent) || 0));
  } catch {
    return 0;
  }
}
