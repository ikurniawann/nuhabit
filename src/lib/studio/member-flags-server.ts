import { ApiError } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { VENUE_TODAY_SQL } from "@/lib/studio/pass-server";
import {
  backofficeCanManage,
  type FlagCategory,
  type FlagSeverity,
  type FlagType,
  flagTypeCode,
  type MemberFlag,
  sortFlags,
} from "@/lib/studio/member-flags";

/**
 * Penanda member perhatian khusus (EPIC-067 T-067-C1/C2) — query & aturan
 * akses. Penanda medis TIDAK PERNAH diambil barisnya untuk backoffice (hanya
 * COUNT), dan untuk coach disaring di SQL dengan syarat memegang sesi hari
 * ini/mendatang yang dibooking member itu, atau pembuat penandanya.
 */

const FLAG_SELECT = `
  SELECT f.id, f.customer_id, f.type_id, t.label AS type_label, t.category, f.severity, f.note,
         f.valid_until::text AS valid_until, f.created_by_coach_id,
         COALESCE(co.display_name, co.full_name, u.full_name) AS created_by_name, f.created_at
  FROM studio.member_flags f
  JOIN studio.member_flag_types t ON t.id = f.type_id
  LEFT JOIN studio.coaches co ON co.id = f.created_by_coach_id
  LEFT JOIN configuration.users u ON u.id = f.created_by`;

const ACTIVE = `f.removed_at IS NULL AND (f.valid_until IS NULL OR f.valid_until >= ${VENUE_TODAY_SQL})`;

/** Coach $1 memegang sesi (tidak batal) hari ini/mendatang yang dibooking member f.customer_id, atau pembuat penanda. */
const COACH_MEDICAL_ACCESS = `(
  f.created_by_coach_id = $1 OR EXISTS (
    SELECT 1 FROM studio.bookings b JOIN studio.class_sessions s ON s.id = b.session_id
    WHERE b.customer_id = f.customer_id AND s.coach_id = $1 AND s.status <> 'cancelled'
      AND s.session_date >= ${VENUE_TODAY_SQL} AND b.status IN ('booked','waitlisted','attended')
  )
)`;

// ── Jenis penanda ──────────────────────────────────────────────────────────

export async function listFlagTypes(includeInactive = false): Promise<FlagType[]> {
  return query<FlagType>(
    `SELECT id, code, label, category, sort_order, is_system, is_active FROM studio.member_flag_types
     WHERE $1 OR is_active ORDER BY sort_order, label`,
    [includeInactive]
  );
}

export async function createFlagType(label: string, category: FlagCategory): Promise<FlagType> {
  const base = flagTypeCode(label);
  for (let i = 0; i < 20; i++) {
    const code = i === 0 ? base : `${base}_${i + 1}`;
    const row = await queryOne<FlagType>(
      `INSERT INTO studio.member_flag_types (code, label, category, sort_order)
       VALUES ($1, $2, $3, 100 + (SELECT COUNT(*) FROM studio.member_flag_types))
       ON CONFLICT (code) DO NOTHING
       RETURNING id, code, label, category, sort_order, is_system, is_active`,
      [code, label, category]
    );
    if (row) return row;
  }
  throw ApiError.conflict("Jenis penanda dengan nama serupa sudah terlalu banyak");
}

export async function setFlagTypeActive(id: string, active: boolean): Promise<void> {
  const rows = await query(`UPDATE studio.member_flag_types SET is_active = $2 WHERE id = $1 RETURNING id`, [id, active]);
  if (rows.length === 0) throw ApiError.notFound("Jenis penanda tidak ditemukan");
}

async function loadActiveType(typeId: string): Promise<FlagType> {
  const t = await queryOne<FlagType>(
    `SELECT id, code, label, category, sort_order, is_system, is_active FROM studio.member_flag_types WHERE id = $1`,
    [typeId]
  );
  if (!t || !t.is_active) throw ApiError.badRequest("Jenis penanda tidak aktif");
  return t;
}

export interface FlagInput {
  type_id: string;
  severity: FlagSeverity;
  note?: string | null;
  valid_until?: string | null;
}

async function insertFlag(
  venue: { companyId: string; branchId: string },
  customerId: string,
  input: FlagInput,
  by: { userId: string; coachId: string | null }
): Promise<string> {
  const customer = await queryOne(`SELECT 1 FROM pos.pos_customers WHERE id = $1`, [customerId]);
  if (!customer) throw ApiError.notFound("Member tidak ditemukan");
  const row = await queryOne<{ id: string }>(
    `INSERT INTO studio.member_flags (company_id, branch_id, customer_id, type_id, severity, note, valid_until, created_by, created_by_coach_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [venue.companyId, venue.branchId, customerId, input.type_id, input.severity, input.note?.trim() || null, input.valid_until || null, by.userId, by.coachId]
  );
  return row!.id;
}

async function loadFlagMeta(flagId: string) {
  return queryOne<{ id: string; branch_id: string; customer_id: string; category: FlagCategory; created_by_coach_id: string | null; removed_at: string | null }>(
    `SELECT f.id, f.branch_id, f.customer_id, t.category, f.created_by_coach_id, f.removed_at
     FROM studio.member_flags f JOIN studio.member_flag_types t ON t.id = f.type_id WHERE f.id = $1`,
    [flagId]
  );
}

async function markRemoved(flagId: string, userId: string) {
  await query(`UPDATE studio.member_flags SET removed_at = now(), removed_by = $2, updated_at = now() WHERE id = $1 AND removed_at IS NULL`, [flagId, userId]);
}

// ── Backoffice (front desk / admin studio) ─────────────────────────────────

export interface BackofficeMemberFlags {
  customer_id: string;
  name: string | null;
  phone: string | null;
  general: MemberFlag[];
  medical_count: number;
}

/**
 * Member dengan penanda aktif di venue. Penanda medis hanya dihitung —
 * barisnya tidak pernah di-SELECT di jalur backoffice.
 */
export async function backofficeFlagSummary(branchId: string, customerId?: string): Promise<BackofficeMemberFlags[]> {
  const members = await query<{ customer_id: string; name: string | null; phone: string | null; medical_count: number }>(
    `SELECT c.id AS customer_id, c.name, c.phone,
            COUNT(f.id) FILTER (WHERE t.category = 'medical' AND ${ACTIVE})::int AS medical_count
     FROM pos.pos_customers c
     LEFT JOIN studio.member_flags f ON f.customer_id = c.id AND f.branch_id = $1
     LEFT JOIN studio.member_flag_types t ON t.id = f.type_id
     WHERE ($2::uuid IS NULL AND EXISTS (SELECT 1 FROM studio.member_flags f2 WHERE f2.customer_id = c.id AND f2.branch_id = $1
              AND f2.removed_at IS NULL AND (f2.valid_until IS NULL OR f2.valid_until >= ${VENUE_TODAY_SQL})))
        OR c.id = $2::uuid
     GROUP BY c.id
     ORDER BY c.name NULLS LAST
     LIMIT 300`,
    [branchId, customerId ?? null]
  );
  if (members.length === 0) return [];
  const general = await query<MemberFlag>(
    `${FLAG_SELECT} WHERE f.branch_id = $1 AND f.customer_id = ANY($2::uuid[]) AND t.category = 'general' AND ${ACTIVE}`,
    [branchId, members.map((m) => m.customer_id)]
  );
  return members.map((m) => ({ ...m, general: sortFlags(general.filter((g) => g.customer_id === m.customer_id)) }));
}

export async function addBackofficeFlag(
  venue: { companyId: string; branchId: string },
  userId: string,
  customerId: string,
  input: FlagInput
): Promise<string> {
  const type = await loadActiveType(input.type_id);
  if (!backofficeCanManage(type.category)) {
    throw ApiError.forbidden("Penanda medis hanya dicatat oleh coach (Coach Portal) — detailnya tidak tampil di backoffice");
  }
  return insertFlag(venue, customerId, input, { userId, coachId: null });
}

export async function removeBackofficeFlag(branchId: string, userId: string, flagId: string): Promise<void> {
  const f = await loadFlagMeta(flagId);
  if (!f || f.branch_id !== branchId || f.removed_at) throw ApiError.notFound("Penanda tidak ditemukan");
  if (!backofficeCanManage(f.category)) throw ApiError.forbidden("Penanda medis hanya bisa dihapus coach");
  await markRemoved(flagId, userId);
}

// ── Coach Portal ───────────────────────────────────────────────────────────

/** Penanda yang boleh dilihat coach untuk sekumpulan member (umum: semua; medis: sesuai aturan akses). */
export async function coachFlagsForCustomers(coachId: string, branchId: string, customerIds: string[]): Promise<MemberFlag[]> {
  if (customerIds.length === 0) return [];
  const rows = await query<MemberFlag>(
    `${FLAG_SELECT}
     WHERE f.branch_id = $2 AND f.customer_id = ANY($3::uuid[]) AND ${ACTIVE}
       AND (t.category = 'general' OR ${COACH_MEDICAL_ACCESS})`,
    [coachId, branchId, customerIds]
  );
  return sortFlags(rows);
}

/** Coach pernah/akan mengajar member ini (sesi tidak batal, 30 hari terakhir s/d mendatang). */
async function assertCoachRelationship(coachId: string, customerId: string) {
  const ok = await queryOne(
    `SELECT 1 FROM studio.bookings b JOIN studio.class_sessions s ON s.id = b.session_id
     WHERE b.customer_id = $2 AND s.coach_id = $1 AND s.status <> 'cancelled'
       AND s.session_date >= ${VENUE_TODAY_SQL} - 30 AND b.status IN ('booked','waitlisted','attended','no_show')
     LIMIT 1`,
    [coachId, customerId]
  );
  if (!ok) throw ApiError.forbidden("Hanya coach yang mengajar member ini yang bisa mencatat penanda");
}

export async function addCoachFlag(
  coach: { id: string; company_id: string; branch_id: string },
  userId: string,
  customerId: string,
  input: FlagInput
): Promise<string> {
  await loadActiveType(input.type_id);
  await assertCoachRelationship(coach.id, customerId);
  return insertFlag({ companyId: coach.company_id, branchId: coach.branch_id }, customerId, input, { userId, coachId: coach.id });
}

export async function removeCoachFlag(coach: { id: string; branch_id: string }, userId: string, flagId: string): Promise<void> {
  const f = await loadFlagMeta(flagId);
  if (!f || f.branch_id !== coach.branch_id || f.removed_at) throw ApiError.notFound("Penanda tidak ditemukan");
  const visible = await coachFlagsForCustomers(coach.id, coach.branch_id, [f.customer_id]);
  if (!visible.some((v) => v.id === flagId)) throw ApiError.notFound("Penanda tidak ditemukan");
  await assertCoachRelationship(coach.id, f.customer_id);
  await markRemoved(flagId, userId);
}
