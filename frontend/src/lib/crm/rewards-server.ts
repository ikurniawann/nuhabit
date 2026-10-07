import "server-only";
/**
 * EPIC-011 Fase F — sisi server alur redeem reward.
 *
 * Dipakai bersama oleh dashboard CRM (kasir/admin klaim di venue) dan portal
 * member (member mengajukan sendiri) agar aturan kelayakan hanya ada satu
 * tempat. XP TIDAK PERNAH dipotong di sini — `min_xp` hanya diperiksa.
 */

import type { Pool, PoolClient } from "pg";
import {
  ACTIVE_REDEMPTION_STATUSES,
  evaluateRewardEligibility,
  quotaWindowStart,
  type EligibilityResult,
  type QuotaPeriod,
} from "@/lib/crm/rewards";

export type RewardRow = {
  id: string;
  code: string;
  name: string;
  reward_type: string;
  min_xp: number;
  required_tier_id: string | null;
  required_tier_rank: number | null;
  required_tier_name: string | null;
  stock_total: number | null;
  stock_redeemed: number;
  max_redemptions_per_member: number | null;
  quota_period: QuotaPeriod;
  image_url: string | null;
  reward_data: Record<string, unknown>;
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
};

export type MemberContext = {
  customerId: string;
  memberProfileId: string | null;
  name: string | null;
  totalXp: number;
  tierRank: number | null;
  tierName: string | null;
};

const REWARD_SELECT = `
  SELECT r.id, r.code, r.name, r.reward_type,
         r.min_xp::int AS min_xp,
         r.required_tier_id,
         t.rank::int AS required_tier_rank,
         t.name AS required_tier_name,
         r.stock_total::int AS stock_total,
         r.stock_redeemed::int AS stock_redeemed,
         r.max_redemptions_per_member::int AS max_redemptions_per_member,
         r.quota_period,
         r.image_url, r.reward_data, r.starts_at, r.ends_at, r.is_active
    FROM crm.crm_rewards r
    LEFT JOIN crm.crm_membership_tiers t ON t.id = r.required_tier_id
`;

/** Katalog reward yang bisa di-redeem (tipe avatar dikecualikan). */
export async function listRedeemableRewards(
  db: Pool | PoolClient,
  options: { includeInactive?: boolean } = {}
): Promise<RewardRow[]> {
  const where = options.includeInactive
    ? `WHERE r.reward_type <> 'avatar'`
    : `WHERE r.reward_type <> 'avatar' AND r.is_active`;

  const { rows } = await db.query(
    `${REWARD_SELECT} ${where} ORDER BY r.min_xp ASC, r.name ASC`
  );
  return rows as RewardRow[];
}

export async function getRewardById(
  db: Pool | PoolClient,
  rewardId: string,
  options: { forUpdate?: boolean } = {}
): Promise<RewardRow | null> {
  // FOR UPDATE hanya boleh mengunci tabel dasar, bukan hasil LEFT JOIN.
  const { rows } = await db.query(
    `${REWARD_SELECT} WHERE r.id = $1 ${options.forUpdate ? "FOR UPDATE OF r" : ""}`,
    [rewardId]
  );
  return (rows[0] as RewardRow | undefined) ?? null;
}

/** Profil member + lifetime XP + tier, bersumber dari pos_customers (Fase B). */
export async function getMemberContext(
  db: Pool | PoolClient,
  customerId: string
): Promise<MemberContext | null> {
  const { rows } = await db.query(
    `SELECT c.id, c.name, c.total_xp::float AS total_xp,
            p.id AS member_profile_id,
            t.rank::int AS tier_rank, t.name AS tier_name
       FROM pos.pos_customers c
       LEFT JOIN crm.crm_member_profiles p ON p.customer_id = c.id
       LEFT JOIN LATERAL (
         SELECT rank, name
           FROM crm.crm_membership_tiers
          WHERE is_active AND min_lifetime_xp <= COALESCE(c.total_xp, 0)
          ORDER BY rank DESC
          LIMIT 1
       ) t ON true
      WHERE c.id = $1`,
    [customerId]
  );

  const row = rows[0];
  if (!row) return null;

  return {
    customerId: row.id,
    memberProfileId: row.member_profile_id ?? null,
    name: row.name ?? null,
    totalXp: Number(row.total_xp) || 0,
    tierRank: row.tier_rank == null ? null : Number(row.tier_rank),
    tierName: row.tier_name ?? null,
  };
}

/** Berapa kali member sudah redeem reward ini di dalam jendela kuota. */
export async function countRedeemedInWindow(
  db: Pool | PoolClient,
  customerId: string,
  rewardId: string,
  quotaPeriod: QuotaPeriod,
  now: Date = new Date()
): Promise<number> {
  const windowStart = quotaWindowStart(quotaPeriod, now);
  const params: unknown[] = [customerId, rewardId, [...ACTIVE_REDEMPTION_STATUSES]];
  let windowClause = "";

  if (windowStart) {
    params.push(windowStart.toISOString());
    windowClause = `AND requested_at >= $4`;
  }

  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS total
       FROM crm.crm_redemptions
      WHERE customer_id = $1 AND reward_id = $2
        AND status = ANY($3) ${windowClause}`,
    params
  );
  return Number(rows[0]?.total) || 0;
}

/**
 * Versi batch untuk katalog: satu query mengambil seluruh redemption aktif
 * member, lalu tiap reward dihitung memakai jendela kuotanya sendiri.
 */
export async function evaluateCatalogForMember(
  db: Pool | PoolClient,
  rewards: RewardRow[],
  member: MemberContext,
  now: Date = new Date()
): Promise<Map<string, EligibilityResult>> {
  const result = new Map<string, EligibilityResult>();
  if (rewards.length === 0) return result;

  const { rows } = await db.query(
    `SELECT reward_id, requested_at
       FROM crm.crm_redemptions
      WHERE customer_id = $1
        AND reward_id = ANY($2)
        AND status = ANY($3)`,
    [member.customerId, rewards.map((reward) => reward.id), [...ACTIVE_REDEMPTION_STATUSES]]
  );

  const historyByReward = new Map<string, Date[]>();
  for (const row of rows as { reward_id: string; requested_at: string | Date }[]) {
    const list = historyByReward.get(row.reward_id) ?? [];
    list.push(row.requested_at instanceof Date ? row.requested_at : new Date(row.requested_at));
    historyByReward.set(row.reward_id, list);
  }

  for (const reward of rewards) {
    const windowStart = quotaWindowStart(reward.quota_period, now);
    const history = historyByReward.get(reward.id) ?? [];
    const redeemedInWindow = windowStart
      ? history.filter((requestedAt) => requestedAt >= windowStart).length
      : history.length;

    result.set(
      reward.id,
      evaluateRewardEligibility(
        {
          is_active: reward.is_active,
          reward_type: reward.reward_type,
          min_xp: Number(reward.min_xp) || 0,
          required_tier_rank: reward.required_tier_rank,
          stock_total: reward.stock_total,
          stock_redeemed: Number(reward.stock_redeemed) || 0,
          max_redemptions_per_member: reward.max_redemptions_per_member,
          quota_period: reward.quota_period,
          starts_at: reward.starts_at,
          ends_at: reward.ends_at,
        },
        {
          total_xp: member.totalXp,
          tier_rank: member.tierRank,
          redeemed_in_window: redeemedInWindow,
        },
        now
      )
    );
  }

  return result;
}

export async function evaluateForMember(
  db: Pool | PoolClient,
  reward: RewardRow,
  member: MemberContext,
  now: Date = new Date()
): Promise<EligibilityResult> {
  const redeemedInWindow = await countRedeemedInWindow(
    db,
    member.customerId,
    reward.id,
    reward.quota_period,
    now
  );

  return evaluateRewardEligibility(
    {
      is_active: reward.is_active,
      reward_type: reward.reward_type,
      min_xp: Number(reward.min_xp) || 0,
      required_tier_rank: reward.required_tier_rank,
      stock_total: reward.stock_total,
      stock_redeemed: Number(reward.stock_redeemed) || 0,
      max_redemptions_per_member: reward.max_redemptions_per_member,
      quota_period: reward.quota_period,
      starts_at: reward.starts_at,
      ends_at: reward.ends_at,
    },
    {
      total_xp: member.totalXp,
      tier_rank: member.tierRank,
      redeemed_in_window: redeemedInWindow,
    },
    now
  );
}

export type CreateRedemptionInput = {
  customerId: string;
  rewardId: string;
  /** portal = diajukan member (pending); admin = diklaim kasir (fulfilled). */
  channel: "portal" | "admin";
  actorUserId?: string | null;
  notes?: string | null;
};

export type CreateRedemptionResult =
  | { ok: true; redemption: Record<string, unknown> }
  | { ok: false; status: number; error: string };

/**
 * Membuat redemption dalam satu transaksi. Baris reward dikunci (FOR UPDATE)
 * lalu kelayakan diperiksa ulang di dalam transaksi, sehingga dua permintaan
 * konkuren tidak bisa menembus stok atau kuota per member.
 */
export async function createRedemption(
  pool: Pool,
  input: CreateRedemptionInput,
  now: Date = new Date()
): Promise<CreateRedemptionResult> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const reward = await getRewardById(client, input.rewardId, { forUpdate: true });
    if (!reward) {
      await client.query("ROLLBACK");
      return { ok: false, status: 404, error: "Reward tidak ditemukan" };
    }

    const member = await getMemberContext(client, input.customerId);
    if (!member) {
      await client.query("ROLLBACK");
      return { ok: false, status: 404, error: "Member tidak ditemukan" };
    }

    const eligibility = await evaluateForMember(client, reward, member, now);
    if (!eligibility.eligible) {
      await client.query("ROLLBACK");
      return {
        ok: false,
        status: 409,
        error: eligibility.reason ?? "Member belum memenuhi syarat redeem",
      };
    }

    const status = input.channel === "admin" ? "fulfilled" : "pending";
    const { rows } = await client.query(
      `INSERT INTO crm.crm_redemptions
         (member_id, customer_id, reward_id, min_xp_at_redeem, total_xp_at_redeem,
          status, channel, requested_by_user_id, processed_by_user_id,
          fulfilled_at, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, redemption_number, status, channel, requested_at, fulfilled_at`,
      [
        member.memberProfileId,
        member.customerId,
        reward.id,
        Number(reward.min_xp) || 0,
        Math.round(member.totalXp),
        status,
        input.channel,
        input.actorUserId ?? null,
        status === "fulfilled" ? input.actorUserId ?? null : null,
        status === "fulfilled" ? now.toISOString() : null,
        input.notes ?? null,
      ]
    );

    // Stok global berkurang begitu redemption dibuat (pending pun menahan stok)
    // agar tidak oversold; dikembalikan saat dibatalkan.
    if (reward.stock_total != null) {
      await client.query(
        `UPDATE crm.crm_rewards SET stock_redeemed = stock_redeemed + 1, updated_at = now()
          WHERE id = $1`,
        [reward.id]
      );
    }

    await client.query("COMMIT");
    return { ok: true, redemption: rows[0] };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export type UpdateRedemptionStatusInput = {
  redemptionId: string;
  action: "approve" | "fulfill" | "cancel";
  actorUserId?: string | null;
  notes?: string | null;
};

/**
 * Whitelist transisi + nama kolom timestamp. Kolom di-lookup dari peta ini
 * (bukan dirangkai dari input) supaya identifier yang masuk ke SQL tidak
 * pernah berasal dari pemanggil, walau pemanggil sekarang sudah zod-validated.
 */
const TRANSITIONS = {
  approve: { from: ["pending"], status: "approved", column: "approved_at" },
  fulfill: { from: ["pending", "approved"], status: "fulfilled", column: "fulfilled_at" },
  cancel: { from: ["pending", "approved"], status: "cancelled", column: "cancelled_at" },
} as const satisfies Record<
  UpdateRedemptionStatusInput["action"],
  { from: readonly string[]; status: string; column: string }
>;

export async function updateRedemptionStatus(
  pool: Pool,
  input: UpdateRedemptionStatusInput,
  now: Date = new Date()
): Promise<CreateRedemptionResult> {
  const transition = Object.prototype.hasOwnProperty.call(TRANSITIONS, input.action)
    ? TRANSITIONS[input.action]
    : undefined;
  if (!transition) {
    return { ok: false, status: 400, error: "Aksi redemption tidak dikenal" };
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const { rows: current } = await client.query(
      `SELECT id, status, reward_id FROM crm.crm_redemptions WHERE id = $1 FOR UPDATE`,
      [input.redemptionId]
    );
    const redemption = current[0];
    if (!redemption) {
      await client.query("ROLLBACK");
      return { ok: false, status: 404, error: "Redemption tidak ditemukan" };
    }

    if (!transition.from.includes(redemption.status)) {
      await client.query("ROLLBACK");
      return {
        ok: false,
        status: 409,
        error: `Redemption berstatus "${redemption.status}" tidak bisa di-${input.action}`,
      };
    }

    const nextStatus = transition.status;
    const timestampColumn = transition.column;

    const { rows } = await client.query(
      `UPDATE crm.crm_redemptions
          SET status = $2,
              ${timestampColumn} = $3,
              processed_by_user_id = COALESCE($4, processed_by_user_id),
              notes = COALESCE($5, notes),
              updated_at = now()
        WHERE id = $1
        RETURNING id, redemption_number, status, channel, requested_at, approved_at, fulfilled_at, cancelled_at`,
      [
        input.redemptionId,
        nextStatus,
        now.toISOString(),
        input.actorUserId ?? null,
        input.notes ?? null,
      ]
    );

    // Batal mengembalikan stok yang tadi ditahan.
    if (input.action === "cancel") {
      await client.query(
        `UPDATE crm.crm_rewards
            SET stock_redeemed = GREATEST(0, stock_redeemed - 1), updated_at = now()
          WHERE id = $1 AND stock_total IS NOT NULL`,
        [redemption.reward_id]
      );
    }

    await client.query("COMMIT");
    return { ok: true, redemption: rows[0] };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
