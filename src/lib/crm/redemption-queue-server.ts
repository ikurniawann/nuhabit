import "server-only";
/**
 * EPIC-011 Fase F — antrean & riwayat redeem reward untuk dashboard.
 * Respons memuat PII member (nama/telepon/XP); gate di route.
 */
import { getPool } from "@/lib/db";

export type RedemptionFilter = {
  status: string | null;
  customerId: string | null;
  memberId: string | null;
  limit: string | null;
};

/** Tabel/kolom Fase F belum ada (migrasi belum diterapkan). */
export function isMissingRedemptionSchema(error: unknown) {
  const candidate = error as { code?: string } | null;
  return candidate?.code === "42P01" || candidate?.code === "42703";
}

/** Batas baris: 1-200, default 100. */
function redemptionLimit(raw: string | null): number {
  const parsed = Number(raw);
  return raw !== null && Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 200) : 100;
}

export async function listRedemptions(filter: RedemptionFilter) {
  const values: unknown[] = [];
  const filters: string[] = [];
  const add = (column: string, value: string) => {
    values.push(value);
    filters.push(`${column} = $${values.length}`);
  };
  if (filter.status && filter.status !== "all") add("r.status", filter.status);
  if (filter.customerId) add("r.customer_id", filter.customerId);
  if (filter.memberId) add("r.member_id", filter.memberId);
  values.push(redemptionLimit(filter.limit));

  const { rows } = await getPool().query(
    `SELECT r.id, r.redemption_number, r.status, r.channel,
            r.min_xp_at_redeem::int AS min_xp_at_redeem,
            r.total_xp_at_redeem::int AS total_xp_at_redeem,
            r.requested_at, r.approved_at, r.fulfilled_at, r.cancelled_at, r.notes,
            r.customer_id, r.voucher_code,
            c.name AS customer_name, c.phone AS customer_phone,
            c.total_xp::float AS customer_total_xp,
            w.id AS reward_id, w.code AS reward_code, w.name AS reward_name,
            w.reward_type,
            json_build_object(
              'id', w.id, 'code', w.code, 'name', w.name,
              'reward_type', w.reward_type, 'min_xp', w.min_xp
            ) AS reward
       FROM crm.crm_redemptions r
       JOIN crm.crm_rewards w ON w.id = r.reward_id
       LEFT JOIN pos.pos_customers c ON c.id = r.customer_id
      ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
      ORDER BY r.requested_at DESC
      LIMIT $${values.length}`,
    values
  );
  return rows;
}
