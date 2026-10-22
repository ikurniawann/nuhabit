import { query, queryOne } from "@/lib/db";
import type { ComplaintCategory, ComplaintSource } from "@/lib/studio/complaints";

/**
 * Laporan keluhan (EPIC-067 T-067-B5): per kategori, per coach, per sumber,
 * dengan waktu respons & selesai rata-rata dan ketepatan batas waktu. Hanya
 * keluhan (kind 'complaint') yang tidak dibatalkan; masukan dihitung terpisah.
 * Periode = tanggal tiket dibuat (WIB), inklusif.
 */

export interface ComplaintMetrics {
  total: number;
  open: number;
  closed: number;
  escalated: number;
  /** Rata-rata jam dari tiket dibuat sampai respons pertama / selesai (null = belum ada data). */
  avg_respond_hours: number | null;
  avg_resolve_hours: number | null;
  /** Porsi tiket yang direspons / selesai sebelum batas waktu, dari tiket yang batasnya sudah lewat atau sudah ditangani. */
  respond_on_time: number | null;
  resolve_on_time: number | null;
}

export interface CoachComplaintRow extends ComplaintMetrics {
  coach_id: string;
  coach_name: string;
  about_coach: number;
  injury: number;
  attendees: number;
  /** Keluhan per 100 peserta hadir (sama dengan KPI coach_complaint_rate). */
  rate_per_100: number | null;
  feedback: number;
}

export interface ComplaintReport {
  from: string;
  to: string;
  summary: ComplaintMetrics & { feedback: number; cancelled: number };
  by_category: (ComplaintMetrics & { category: ComplaintCategory })[];
  by_source: (ComplaintMetrics & { source: ComplaintSource })[];
  by_coach: CoachComplaintRow[];
}

/** Agregat bersama — dipakai per kelompok (GROUP BY di pemanggil). */
const METRICS = `
  COUNT(*)::int AS total,
  COUNT(*) FILTER (WHERE k.status IN ('received','in_progress'))::int AS open,
  COUNT(*) FILTER (WHERE k.status IN ('resolved','confirmed'))::int AS closed,
  COUNT(*) FILTER (WHERE k.respond_escalated_at IS NOT NULL OR k.resolve_escalated_at IS NOT NULL)::int AS escalated,
  ROUND((AVG(EXTRACT(EPOCH FROM (k.first_response_at - k.created_at))) / 3600)::numeric, 1)::float AS avg_respond_hours,
  ROUND((AVG(EXTRACT(EPOCH FROM (k.resolved_at - k.created_at))) / 3600)::numeric, 1)::float AS avg_resolve_hours,
  (COUNT(*) FILTER (WHERE k.first_response_at IS NOT NULL AND k.first_response_at <= k.respond_by)::float
    / NULLIF(COUNT(*) FILTER (WHERE k.first_response_at IS NOT NULL OR k.respond_by < now()), 0)) AS respond_on_time,
  (COUNT(*) FILTER (WHERE k.resolved_at IS NOT NULL AND k.resolved_at <= k.resolve_by)::float
    / NULLIF(COUNT(*) FILTER (WHERE k.resolved_at IS NOT NULL OR k.resolve_by < now()), 0)) AS resolve_on_time`;

/** Keluhan dalam periode (tanpa masukan & tiket batal). */
const IN_PERIOD = `k.branch_id = $1 AND (k.created_at AT TIME ZONE 'Asia/Jakarta')::date BETWEEN $2::date AND $3::date`;
const COMPLAINTS = `${IN_PERIOD} AND k.kind = 'complaint' AND k.status <> 'cancelled'`;

export async function complaintReport(branchId: string, from: string, to: string): Promise<ComplaintReport> {
  const params = [branchId, from, to];
  const [summary, extra, byCategory, bySource, byCoach] = await Promise.all([
    queryOne<ComplaintMetrics>(`SELECT ${METRICS} FROM studio.complaints k WHERE ${COMPLAINTS}`, params),
    queryOne<{ feedback: number; cancelled: number }>(
      `SELECT COUNT(*) FILTER (WHERE k.kind = 'feedback')::int AS feedback,
              COUNT(*) FILTER (WHERE k.kind = 'complaint' AND k.status = 'cancelled')::int AS cancelled
       FROM studio.complaints k WHERE ${IN_PERIOD}`,
      params
    ),
    query<ComplaintMetrics & { category: ComplaintCategory }>(
      `SELECT k.category, ${METRICS} FROM studio.complaints k WHERE ${COMPLAINTS} GROUP BY k.category ORDER BY total DESC, k.category`,
      params
    ),
    query<ComplaintMetrics & { source: ComplaintSource }>(
      `SELECT k.source, ${METRICS} FROM studio.complaints k WHERE ${COMPLAINTS} GROUP BY k.source ORDER BY total DESC, k.source`,
      params
    ),
    // Semua coach yang punya peserta / keluhan / masukan di periode, supaya coach tanpa keluhan juga terlihat.
    query<CoachComplaintRow>(
      `WITH att AS (
         SELECT s.coach_id, COUNT(*)::int AS attendees
         FROM studio.bookings b JOIN studio.class_sessions s ON s.id = b.session_id
         WHERE s.branch_id = $1 AND b.status = 'attended' AND s.session_date BETWEEN $2::date AND $3::date AND s.coach_id IS NOT NULL
         GROUP BY s.coach_id
       ), kel AS (
         SELECT k.coach_id, ${METRICS},
                COUNT(*) FILTER (WHERE k.category = 'coach')::int AS about_coach,
                COUNT(*) FILTER (WHERE k.category = 'injury')::int AS injury
         FROM studio.complaints k WHERE ${COMPLAINTS} AND k.coach_id IS NOT NULL
         GROUP BY k.coach_id
       ), fb AS (
         SELECT k.coach_id, COUNT(*)::int AS feedback
         FROM studio.complaints k WHERE ${IN_PERIOD} AND k.kind = 'feedback' AND k.coach_id IS NOT NULL
         GROUP BY k.coach_id
       )
       SELECT c.id AS coach_id, COALESCE(c.display_name, c.full_name) AS coach_name,
              COALESCE(kel.total, 0) AS total, COALESCE(kel.open, 0) AS open, COALESCE(kel.closed, 0) AS closed,
              COALESCE(kel.escalated, 0) AS escalated, kel.avg_respond_hours, kel.avg_resolve_hours,
              kel.respond_on_time, kel.resolve_on_time,
              COALESCE(kel.about_coach, 0) AS about_coach, COALESCE(kel.injury, 0) AS injury,
              COALESCE(att.attendees, 0) AS attendees,
              CASE WHEN COALESCE(att.attendees, 0) > 0 THEN ROUND((COALESCE(kel.total, 0) * 100.0 / att.attendees)::numeric, 2)::float END AS rate_per_100,
              COALESCE(fb.feedback, 0) AS feedback
       FROM studio.coaches c
       LEFT JOIN att ON att.coach_id = c.id
       LEFT JOIN kel ON kel.coach_id = c.id
       LEFT JOIN fb ON fb.coach_id = c.id
       WHERE c.branch_id = $1 AND (att.coach_id IS NOT NULL OR kel.coach_id IS NOT NULL OR fb.coach_id IS NOT NULL)
       ORDER BY COALESCE(kel.total, 0) DESC, rate_per_100 DESC NULLS LAST, coach_name`,
      params
    ),
  ]);
  return {
    from,
    to,
    summary: { ...summary!, feedback: extra?.feedback ?? 0, cancelled: extra?.cancelled ?? 0 },
    by_category: byCategory,
    by_source: bySource,
    by_coach: byCoach,
  };
}
