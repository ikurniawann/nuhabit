import "server-only";
/** Insentif coach: skema tarif, statement bulanan, dan payout. */
import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { getPool, withTransaction } from "@/lib/db";
import { isUniqueViolation } from "./staff-route";
import {
  computeCoachStatement,
  decidePayoutAction,
  monthPeriod,
  resolveScheme,
  type CoachStatement,
  type IncentiveScheme,
  type PayoutAction,
  type PayoutStatus,
  type StatementSession,
} from "./incentive";

/* ── Skema ───────────────────────────────────────────────────────────── */

export interface SchemeRow extends IncentiveScheme {
  name: string;
  coachName: string | null;
  updatedAt: string;
}

/** Semua skema beserta tarif per jenis kelas. Angka rupiah sebagai number. */
export async function loadSchemes(): Promise<SchemeRow[]> {
  const { rows } = await getPool().query<SchemeRow>(
    `SELECT s.id, s.name, s.coach_id AS "coachId", c.name AS "coachName", s.is_default AS "isDefault",
            s.session_fee_idr::float AS "sessionFeeIdr", s.per_attendee_idr::float AS "perAttendeeIdr",
            s.full_class_bonus_idr::float AS "fullClassBonusIdr",
            s.full_class_threshold_percent AS "fullClassThresholdPercent",
            s.no_show_penalty_idr::float AS "noShowPenaltyIdr", s.is_active AS "isActive", s.updated_at AS "updatedAt",
            COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                       'classTypeId', r.class_type_id,
                       'sessionFeeIdr', r.session_fee_idr::float,
                       'perAttendeeIdr', r.per_attendee_idr::float) ORDER BY r.created_at)
                FROM gym.incentive_scheme_rates r WHERE r.scheme_id = s.id
            ), '[]'::jsonb) AS rates
       FROM gym.incentive_schemes s LEFT JOIN gym.coaches c ON c.id = s.coach_id
      ORDER BY s.is_default DESC, c.name`
  );
  return rows;
}

/** Skema (default dulu) + daftar coach dan jenis kelas untuk form. */
export async function loadSchemeForm() {
  const db = getPool();
  const [schemes, coaches, classTypes] = await Promise.all([
    loadSchemes(),
    db.query(`SELECT id, name, status FROM gym.coaches ORDER BY name`),
    db.query(`SELECT id, name, status FROM gym.class_types ORDER BY name`),
  ]);
  return { schemes, coaches: coaches.rows, class_types: classTypes.rows };
}

const idr = z.number().min(0).max(100_000_000);

export const schemeSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2).max(80),
  /** null = skema default organisasi. */
  coach_id: z.string().uuid().nullable(),
  session_fee_idr: idr,
  per_attendee_idr: idr,
  full_class_bonus_idr: idr,
  full_class_threshold_percent: z.number().int().min(0).max(100),
  no_show_penalty_idr: idr,
  is_active: z.boolean().default(true),
  rates: z
    .array(z.object({ class_type_id: z.string().uuid(), session_fee_idr: idr, per_attendee_idr: idr }))
    .max(50)
    .default([])
    .refine((rates) => new Set(rates.map((r) => r.class_type_id)).size === rates.length, "Satu tarif per jenis kelas"),
});

export type SchemeInput = z.infer<typeof schemeSchema>;

/**
 * Buat atau ubah skema, tarif per jenis kelas diganti seluruhnya.
 * Hanya ada satu default (coach_id null) dan satu skema per coach.
 */
export async function saveScheme(s: SchemeInput, actorId: string): Promise<string> {
  try {
    const id = await withTransaction(async (client) => {
      const params = [
        s.name, s.coach_id, s.coach_id === null, s.session_fee_idr, s.per_attendee_idr, s.full_class_bonus_idr,
        s.full_class_threshold_percent, s.no_show_penalty_idr, s.coach_id === null ? true : s.is_active, actorId,
      ];
      const { rows } = s.id
        ? await client.query<{ id: string }>(
            `UPDATE gym.incentive_schemes SET name=$1, coach_id=$2, is_default=$3, session_fee_idr=$4,
                    per_attendee_idr=$5, full_class_bonus_idr=$6, full_class_threshold_percent=$7,
                    no_show_penalty_idr=$8, is_active=$9, updated_by=$10, updated_at=now()
              WHERE id=$11 RETURNING id`,
            [...params, s.id]
          )
        : await client.query<{ id: string }>(
            `INSERT INTO gym.incentive_schemes (name, coach_id, is_default, session_fee_idr, per_attendee_idr,
                    full_class_bonus_idr, full_class_threshold_percent, no_show_penalty_idr, is_active, updated_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
            params
          );
      const schemeId = rows[0]?.id;
      if (!schemeId) return null;
      await client.query(`DELETE FROM gym.incentive_scheme_rates WHERE scheme_id = $1`, [schemeId]);
      if (s.rates.length > 0) {
        await client.query(
          `INSERT INTO gym.incentive_scheme_rates (scheme_id, class_type_id, session_fee_idr, per_attendee_idr)
           SELECT $1, r.class_type_id, r.session_fee_idr, r.per_attendee_idr
             FROM jsonb_to_recordset($2::jsonb) AS r(class_type_id uuid, session_fee_idr numeric, per_attendee_idr numeric)`,
          [schemeId, JSON.stringify(s.rates)]
        );
      }
      return schemeId;
    });
    if (!id) throw ApiError.notFound("Skema tidak ditemukan");
    return id;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw ApiError.conflict(s.coach_id ? "Coach ini sudah punya skema sendiri" : "Skema default sudah ada");
    }
    throw error;
  }
}

/** Hapus skema khusus coach; coach kembali memakai skema default. */
export async function deleteScheme(id: string): Promise<void> {
  const { rowCount } = await getPool().query(`DELETE FROM gym.incentive_schemes WHERE id = $1 AND NOT is_default`, [id]);
  if (!rowCount) throw ApiError.notFound("Skema tidak ditemukan atau skema default (tidak bisa dihapus)");
}

/* ── Statement ───────────────────────────────────────────────────────── */

export interface CoachStatementView extends CoachStatement {
  coachName: string;
  schemeName: string;
  /** Payout hidup (bukan void) untuk bulan ini, bila sudah dibuat. */
  payout: { id: string; status: PayoutStatus; totalIdr: number } | null;
}

/**
 * Statement bulanan per coach dari kelas `completed` + booking-nya.
 * Tanpa `coachId`: setiap coach aktif atau yang punya kelas di bulan itu.
 */
export async function coachStatements(periodMonth: string, coachId: string | null = null): Promise<CoachStatementView[]> {
  const db = getPool();
  const period = monthPeriod(periodMonth);
  const [schemes, sessions, coaches, payouts] = await Promise.all([
    loadSchemes(),
    db.query<StatementSession>(
      `SELECT cs.id, cs.coach_id AS "coachId", cs.class_type_id AS "classTypeId", ct.name AS "classTypeName",
              cs.starts_at AS "startsAt", cs.capacity, cs.status,
              COALESCE(array_agg(b.status) FILTER (WHERE b.id IS NOT NULL), '{}') AS "bookingStatuses"
         FROM gym.class_sessions cs
         JOIN gym.class_types ct ON ct.id = cs.class_type_id
         LEFT JOIN gym.bookings b ON b.session_id = cs.id
        WHERE cs.status = 'completed' AND cs.coach_id IS NOT NULL
          AND cs.starts_at >= $1 AND cs.starts_at < $2
          AND ($3::uuid IS NULL OR cs.coach_id = $3)
        GROUP BY cs.id, ct.name`,
      [period.start, period.end, coachId]
    ),
    db.query<{ id: string; name: string; status: string }>(
      `SELECT id, name, status FROM gym.coaches WHERE ($1::uuid IS NULL OR id = $1) ORDER BY name`,
      [coachId]
    ),
    db.query<{ id: string; coach_id: string; status: PayoutStatus; total_idr: number }>(
      `SELECT id, coach_id, status, total_idr::float AS total_idr FROM gym.coach_payouts
        WHERE period_month = $1::date AND status <> 'void'`,
      [`${periodMonth}-01`]
    ),
  ]);

  const defaultScheme = schemes.find((s) => s.isDefault);
  if (!defaultScheme) throw new Error("Skema insentif default belum ada");

  const rows = sessions.rows.map((s) => ({ ...s, startsAt: new Date(s.startsAt).toISOString() }));
  const coachesWithClasses = new Set(rows.map((s) => s.coachId));

  return coaches.rows
    .filter((c) => c.status === "active" || coachesWithClasses.has(c.id))
    .map((coach) => {
      const scheme = resolveScheme(defaultScheme, schemes.find((s) => s.coachId === coach.id) ?? null);
      const statement = computeCoachStatement({ coachId: coach.id, periodMonth, scheme, sessions: rows });
      const payout = payouts.rows.find((p) => p.coach_id === coach.id);
      return {
        ...statement,
        coachName: coach.name,
        schemeName: scheme.name,
        payout: payout ? { id: payout.id, status: payout.status, totalIdr: payout.total_idr } : null,
      };
    });
}

/* ── Payout ──────────────────────────────────────────────────────────── */

/** Payout terbaru dulu, dengan nama coach; `month` (YYYY-MM) menyaring periode. */
export async function listPayouts(month: string | null) {
  const { rows } = await getPool().query(
    `SELECT p.id, p.coach_id, c.name AS coach_name, to_char(p.period_month, 'YYYY-MM') AS month,
            p.total_idr::float AS total_idr, p.status, p.payment_reference, p.note,
            (p.statement->'totals'->>'sessions')::int AS sessions,
            p.created_at, p.approved_at, p.paid_at, p.voided_at
       FROM gym.coach_payouts p JOIN gym.coaches c ON c.id = p.coach_id
      WHERE ($1::text IS NULL OR p.period_month = ($1 || '-01')::date)
      ORDER BY p.period_month DESC, (p.status = 'void'), c.name
      LIMIT 200`,
    [month]
  );
  return rows;
}

/** Satu payout beserta statement yang dibekukan. */
export async function getPayout(id: string) {
  const { rows } = await getPool().query(
    `SELECT p.id, p.coach_id, c.name AS coach_name, to_char(p.period_month, 'YYYY-MM') AS month, p.statement,
            p.total_idr::float AS total_idr, p.status, p.payment_reference, p.note,
            p.created_at, p.approved_at, p.paid_at, p.voided_at
       FROM gym.coach_payouts p JOIN gym.coaches c ON c.id = p.coach_id
      WHERE p.id = $1`,
    [id]
  );
  if (!rows[0]) throw ApiError.notFound("Payout tidak ditemukan");
  return rows[0];
}

/**
 * Bekukan statement coach untuk satu bulan sebagai payout draf. Index unik
 * parsial menolak payout hidup kedua untuk coach + bulan yang sama.
 */
export async function createPayout(userId: string, coachId: string, periodMonth: string): Promise<string> {
  const [statement] = await coachStatements(periodMonth, coachId);
  if (!statement) throw ApiError.notFound("Coach tidak ditemukan");
  const { rows } = await getPool().query<{ id: string }>(
    `INSERT INTO gym.coach_payouts (coach_id, period_month, statement, total_idr, created_by)
     VALUES ($1, $2::date, $3::jsonb, $4, $5)
     ON CONFLICT (coach_id, period_month) WHERE status <> 'void' DO NOTHING
     RETURNING id`,
    [coachId, `${periodMonth}-01`, JSON.stringify(statement), statement.totals.totalIdr, userId]
  );
  if (!rows[0]) throw ApiError.conflict("Coach ini sudah punya payout aktif untuk bulan tersebut");
  return rows[0].id;
}

/** Setujui, bayar (wajib referensi), atau void (wajib alasan) satu payout. */
export async function actOnPayout(
  userId: string,
  payoutId: string,
  action: PayoutAction,
  input: { paymentReference?: string | null; note?: string | null }
): Promise<void> {
  await withTransaction(async (client) => {
    const { rows } = await client.query<{ status: PayoutStatus }>(
      `SELECT status FROM gym.coach_payouts WHERE id = $1 FOR UPDATE`,
      [payoutId]
    );
    if (!rows[0]) throw ApiError.notFound("Payout tidak ditemukan");
    const decision = decidePayoutAction(rows[0].status, action, input);
    if (!decision.ok) throw ApiError.conflict(decision.error);
    await client.query(
      `UPDATE gym.coach_payouts SET
          status = $2,
          approved_by = CASE WHEN $2 = 'approved' THEN $3::uuid ELSE approved_by END,
          approved_at = CASE WHEN $2 = 'approved' THEN now() ELSE approved_at END,
          paid_by = CASE WHEN $2 = 'paid' THEN $3::uuid ELSE paid_by END,
          paid_at = CASE WHEN $2 = 'paid' THEN now() ELSE paid_at END,
          payment_reference = COALESCE($4, payment_reference),
          voided_by = CASE WHEN $2 = 'void' THEN $3::uuid ELSE voided_by END,
          voided_at = CASE WHEN $2 = 'void' THEN now() ELSE voided_at END,
          note = COALESCE($5, note),
          updated_at = now()
        WHERE id = $1`,
      [payoutId, decision.status, userId, decision.paymentReference, decision.note]
    );
  });
}
