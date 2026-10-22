import type { PoolClient } from "pg";
import { query, queryOne, withTransaction } from "@/lib/db";
import { wibNow } from "@/lib/studio/jobs";
import { isFrozen, type MemberStatus } from "@/lib/studio/loyalty";
import {
  evaluateMembership,
  keepTier,
  membershipBenefits,
  type MembershipEvaluation,
  type MembershipTier,
  nextTier,
  sortTiers,
  windowStart,
} from "@/lib/studio/membership";

/**
 * Membership (EPIC-069): spending 12 bulan berjalan → tier loyalitas + perks.
 * Tier dievaluasi saat data member dibaca dan tiap tutup hari; hasilnya
 * disimpan di studio.member_memberships (dipakai query yang tidak mengevaluasi
 * ulang, mis. urutan waitlist & daftar pelanggan POS).
 */

const TIER_COLUMNS = `id, name, min_spend::float8 AS min_spend, display_color, discount_percent::float8 AS discount_percent,
  early_booking_days, cancel_window_hours, waitlist_priority, perks`;

export async function loadMembershipTiers(): Promise<MembershipTier[]> {
  return sortTiers(await query<MembershipTier>(`SELECT ${TIER_COLUMNS} FROM studio.membership_tiers WHERE is_active ORDER BY min_spend`));
}

export interface SpendBreakdown {
  total: number;
  passes: number;
  pos: number;
  from: string;
  to: string;
}

/**
 * Spending member pada jendela 12 bulan s/d `today` (WIB): paket kelas &
 * Personal Training yang sudah dibayar (bukan complimentary/pending/batal) +
 * order POS lunas (bukan void/batal/merge).
 */
export async function memberSpend(customerId: string, today: string, db: Pick<PoolClient, "query"> | null = null): Promise<SpendBreakdown> {
  const from = windowStart(today);
  const sql = `SELECT
      (SELECT COALESCE(SUM(price_paid), 0)::float8 FROM studio.member_passes
        WHERE customer_id = $1 AND channel <> 'complimentary' AND price_paid > 0
          AND status IN ('active', 'expired', 'exhausted')
          AND (COALESCE(paid_at, created_at) AT TIME ZONE 'Asia/Jakarta')::date BETWEEN $2::date AND $3::date) AS passes,
      (SELECT COALESCE(SUM(total_amount), 0)::float8 FROM pos.pos_orders
        WHERE customer_id = $1 AND payment_status = 'paid' AND voided_at IS NULL
          AND status NOT IN ('cancelled', 'voided', 'merged')
          AND (created_at AT TIME ZONE 'Asia/Jakarta')::date BETWEEN $2::date AND $3::date) AS pos`;
  const params = [customerId, from, today];
  const row = db ? ((await db.query(sql, params)).rows[0] as { passes: number; pos: number }) : await queryOne<{ passes: number; pos: number }>(sql, params);
  const passes = Number(row?.passes ?? 0);
  const pos = Number(row?.pos ?? 0);
  return { total: passes + pos, passes, pos, from, to: today };
}

interface StoredState {
  tier_id: string | null;
  valid_until: string | null;
  spend_12m: number;
  evaluated_on: string;
}

/**
 * Evaluasi & simpan tier Membership satu member (idempoten; baris dikunci
 * supaya evaluasi paralel tidak mencatat perubahan ganda).
 */
export async function evaluateMember(
  customerId: string,
  opts: { today?: string; tiers?: MembershipTier[] } = {}
): Promise<MembershipEvaluation & { spend: SpendBreakdown }> {
  const today = opts.today ?? wibNow().date;
  const tiers = opts.tiers ?? (await loadMembershipTiers());
  return withTransaction(async (client) => {
    await client.query(
      `INSERT INTO studio.member_memberships (customer_id, evaluated_on) VALUES ($1, $2::date) ON CONFLICT (customer_id) DO NOTHING`,
      [customerId, today]
    );
    const { rows } = await client.query(
      `SELECT tier_id, valid_until::text AS valid_until, spend_12m::float8 AS spend_12m, evaluated_on::text AS evaluated_on
       FROM studio.member_memberships WHERE customer_id = $1 FOR UPDATE`,
      [customerId]
    );
    const state = rows[0] as StoredState;
    const spend = await memberSpend(customerId, today, client);
    const result = evaluateMembership(tiers, spend.total, state, today);
    const tierId = result.tier?.id ?? null;
    if (tierId !== state.tier_id || result.valid_until !== state.valid_until || spend.total !== state.spend_12m || today !== state.evaluated_on) {
      await client.query(
        `UPDATE studio.member_memberships SET tier_id = $2, valid_until = $3::date, spend_12m = $4, evaluated_on = $5::date, updated_at = now()
         WHERE customer_id = $1`,
        [customerId, tierId, result.valid_until, spend.total, today]
      );
    }
    if (result.change) {
      await client.query(
        `INSERT INTO studio.membership_tier_changes (customer_id, from_tier_id, to_tier_id, from_tier_name, to_tier_name, direction, spend_12m)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          customerId,
          result.change.from?.id ?? null,
          result.change.to?.id ?? null,
          result.change.from?.name ?? null,
          result.change.to?.name ?? null,
          result.change.direction,
          spend.total,
        ]
      );
    }
    return { ...result, spend };
  });
}

async function statusOf(customerId: string): Promise<MemberStatus> {
  const row = await queryOne<{ status: MemberStatus }>(`SELECT status FROM crm.crm_member_profiles WHERE customer_id = $1`, [customerId]);
  return row?.status ?? "active";
}

/** Benefit booking + diskon dari tier Membership (member diblokir/banned: tanpa benefit). */
export async function memberMembershipBenefits(customerId: string) {
  const [ev, status] = await Promise.all([evaluateMember(customerId), statusOf(customerId)]);
  return membershipBenefits(ev.tier, isFrozen(status));
}

/** Persen diskon F&B/POS member dari tier Membership (0 bila gagal — tidak boleh menggagalkan order). */
export async function memberMembershipDiscount(customerId: string): Promise<number> {
  try {
    return (await memberMembershipBenefits(customerId)).discount_percent;
  } catch (e) {
    console.error("[membership] diskon member gagal dibaca:", e);
    return 0;
  }
}

/**
 * Diskon tersimpan untuk banyak member sekaligus (daftar pelanggan POS) —
 * tanpa evaluasi ulang; tier sudah disegarkan saat dibaca & tiap tutup hari.
 */
export async function storedMembershipDiscounts(customerIds: string[]): Promise<Record<string, number>> {
  if (!customerIds.length) return {};
  const rows = await query<{ customer_id: string; discount_percent: number }>(
    `SELECT mm.customer_id, t.discount_percent::float8 AS discount_percent
     FROM studio.member_memberships mm
     JOIN studio.membership_tiers t ON t.id = mm.tier_id AND t.is_active
     LEFT JOIN crm.crm_member_profiles mp ON mp.customer_id = mm.customer_id
     WHERE mm.customer_id = ANY($1::uuid[]) AND COALESCE(mp.status, 'active') NOT IN ('suspended', 'banned')`,
    [customerIds]
  );
  return Object.fromEntries(rows.map((r) => [r.customer_id, Number(r.discount_percent) || 0]));
}

/** Ringkasan Membership untuk Member App. */
export async function memberMembership(customerId: string) {
  const tiers = await loadMembershipTiers();
  const [ev, status] = await Promise.all([evaluateMember(customerId, { tiers }), statusOf(customerId)]);
  const frozen = isFrozen(status);
  const history = await query<{ direction: "up" | "down"; from_tier_name: string | null; to_tier_name: string | null; created_at: string }>(
    `SELECT direction, from_tier_name, to_tier_name, created_at FROM studio.membership_tier_changes
     WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 5`,
    [customerId]
  );
  return {
    enabled: tiers.length > 0,
    frozen,
    tier: ev.tier,
    valid_until: ev.valid_until,
    spend: ev.spend,
    next: nextTier(tiers, ev.tier, ev.spend.total),
    keep: keepTier(ev.tier, ev.spend.total, ev.valid_until),
    benefits: membershipBenefits(ev.tier, frozen),
    tiers,
    history,
  };
}

/**
 * Evaluasi ulang semua member yang punya data Membership atau belanja dalam
 * 12 bulan (tutup hari & setelah tier diubah). Mengembalikan jumlah yang
 * tiernya berubah.
 */
export async function evaluateAllMemberships(today: string = wibNow().date): Promise<number> {
  const tiers = await loadMembershipTiers();
  const from = windowStart(today);
  const ids = await query<{ id: string }>(
    `SELECT customer_id AS id FROM studio.member_memberships
     UNION SELECT customer_id FROM studio.member_passes
       WHERE price_paid > 0 AND (COALESCE(paid_at, created_at) AT TIME ZONE 'Asia/Jakarta')::date >= $1::date
     UNION SELECT customer_id FROM pos.pos_orders
       WHERE customer_id IS NOT NULL AND payment_status = 'paid' AND (created_at AT TIME ZONE 'Asia/Jakarta')::date >= $1::date`,
    [from]
  );
  let changed = 0;
  for (const { id } of ids) {
    try {
      if ((await evaluateMember(id, { today, tiers })).change) changed += 1;
    } catch (e) {
      console.error("[membership] evaluasi gagal untuk", id, e);
    }
  }
  return changed;
}

/** Ringkasan backoffice: jumlah member per tier (tersimpan). */
export async function membershipTierCounts(): Promise<Record<string, number>> {
  const rows = await query<{ tier_id: string; n: number }>(
    `SELECT tier_id, COUNT(*)::int AS n FROM studio.member_memberships WHERE tier_id IS NOT NULL GROUP BY tier_id`
  );
  return Object.fromEntries(rows.map((r) => [r.tier_id, r.n]));
}
