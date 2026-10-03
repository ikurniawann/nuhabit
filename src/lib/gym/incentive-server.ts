import { getPool, withTransaction } from "@/lib/db";
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

export type PayoutOutcome = { ok: true; id: string } | { ok: false; status: 404 | 409; error: string };

/**
 * Bekukan statement coach untuk satu bulan sebagai payout draf. Index unik
 * parsial menolak payout hidup kedua untuk coach + bulan yang sama.
 */
export async function createPayout(userId: string, coachId: string, periodMonth: string): Promise<PayoutOutcome> {
  const [statement] = await coachStatements(periodMonth, coachId);
  if (!statement) return { ok: false, status: 404, error: "Coach tidak ditemukan" };
  const { rows } = await getPool().query<{ id: string }>(
    `INSERT INTO gym.coach_payouts (coach_id, period_month, statement, total_idr, created_by)
     VALUES ($1, $2::date, $3::jsonb, $4, $5)
     ON CONFLICT (coach_id, period_month) WHERE status <> 'void' DO NOTHING
     RETURNING id`,
    [coachId, `${periodMonth}-01`, JSON.stringify(statement), statement.totals.totalIdr, userId]
  );
  if (!rows[0]) return { ok: false, status: 409, error: "Coach ini sudah punya payout aktif untuk bulan tersebut" };
  return { ok: true, id: rows[0].id };
}

/** Setujui, bayar (wajib referensi), atau void (wajib alasan) satu payout. */
export async function actOnPayout(
  userId: string,
  payoutId: string,
  action: PayoutAction,
  input: { paymentReference?: string | null; note?: string | null }
): Promise<PayoutOutcome> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<{ status: PayoutStatus }>(
      `SELECT status FROM gym.coach_payouts WHERE id = $1 FOR UPDATE`,
      [payoutId]
    );
    if (!rows[0]) return { ok: false, status: 404, error: "Payout tidak ditemukan" };
    const decision = decidePayoutAction(rows[0].status, action, input);
    if (!decision.ok) return { ok: false, status: 409, error: decision.error };
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
    return { ok: true, id: payoutId };
  });
}
