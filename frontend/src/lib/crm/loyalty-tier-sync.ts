// Sinkronisasi pos_customers & tier setelah XP/belanja berubah.
import type { DbClient } from "@/lib/pg/types";
import { toNumber } from "@/lib/crm/server";
import { pickTierForXp, type CrmTier, type PosCustomerLoyaltyRow } from "./loyalty-rules";

/**
 * Salin XP yang baru terposting ke pos_customers.total_xp. Statistik
 * kunjungan/belanja ada di syncPosCustomerOrderStats; current_xp sudah di-DROP
 * pada EPIC-011 Fase B (EPIC-014, 25 Jul 2026).
 */
async function addPosCustomerXp(db: DbClient, customerId: string, xpAwarded: number) {
  const { data: customer, error } = await db
    .from("pos_customers")
    .select("total_xp")
    .eq("id", customerId)
    .maybeSingle();

  if (error || !customer) return;

  await db
    .from("pos_customers")
    .update({
      total_xp: toNumber((customer as PosCustomerLoyaltyRow).total_xp) + xpAwarded,
      updated_at: new Date().toISOString(),
    })
    .eq("id", customerId);
}

/** Setelah XP earn terposting: mirror ke pos_customers lalu evaluasi ulang tier. */
export async function syncAfterEarn(db: DbClient, customerId: string, xpAwarded: number) {
  await addPosCustomerXp(db, customerId, xpAwarded);
  await syncTierAfterEarn(db, customerId);
}

/**
 * Statistik kunjungan/belanja customer — dipanggil untuk SETIAP order dibayar
 * apapun metodenya (terpisah dari XP yang hanya untuk pembayaran ARK Coin).
 * total_spent = nilai belanja/order (topup TIDAK dihitung) — dasar top spender.
 */
export async function syncPosCustomerOrderStats(
  db: DbClient,
  customerId: string,
  amount: number
) {
  try {
    const { data: customer, error } = await db
      .from("pos_customers")
      .select("total_spent, visit_count")
      .eq("id", customerId)
      .maybeSingle();

    if (error || !customer) return;

    const row = customer as PosCustomerLoyaltyRow;
    const now = new Date().toISOString();
    await db
      .from("pos_customers")
      .update({
        total_spent: toNumber(row.total_spent) + amount,
        visit_count: toNumber(row.visit_count) + 1,
        last_visit: now,
        updated_at: now,
      })
      .eq("id", customerId);
  } catch (error) {
    console.error("CRM customer stats sync failed:", error);
  }
}

export async function syncTierAfterEarn(db: DbClient, customerId: string) {
  const { data: profile, error: profileError } = await db
    .from("crm_member_profiles")
    .select("id, tier_id, lifetime_xp")
    .eq("customer_id", customerId)
    .maybeSingle();

  if (profileError || !profile) return;

  const { data: tiers, error: tiersError } = await db
    .from("crm_membership_tiers")
    .select("*")
    .eq("is_active", true)
    .order("rank", { ascending: false });

  if (tiersError || !tiers?.length) return;

  // Sumber XP kanonik = pos_customers.total_xp (keputusan EPIC-014 25 Jul —
  // lifetime_xp profil hanya mirror; bila keduanya sempat menyimpang, angka
  // customer yang menang). Fallback ke mirror bila baris customer tak terbaca.
  const profileRow = profile as { id: string; tier_id: string; lifetime_xp: number | string };
  const { data: customer } = await db
    .from("pos_customers")
    .select("total_xp")
    .eq("id", customerId)
    .maybeSingle();
  const lifetimeXp =
    customer != null
      ? toNumber((customer as PosCustomerLoyaltyRow).total_xp)
      : toNumber(profileRow.lifetime_xp);
  const nextTier = pickTierForXp(tiers as CrmTier[], lifetimeXp);

  if (nextTier && nextTier.id !== profileRow.tier_id) {
    await db
      .from("crm_member_profiles")
      .update({ tier_id: nextTier.id })
      .eq("id", profileRow.id);

    await db
      .from("pos_customers")
      .update({ membership_tier: nextTier.code, updated_at: new Date().toISOString() })
      .eq("id", customerId);
  }
}
