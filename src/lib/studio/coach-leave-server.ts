import { ApiError } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import {
  type ApproverCandidate,
  type BlackoutPeriod,
  blackoutConflicts,
  canDecideCoachLeave,
  COACH_LEAVE_SETTING_KEYS,
  type CoachLeaveSettings,
  DEFAULT_COACH_LEAVE_SETTINGS,
  evaluateLeaveNotice,
  type ImpactedSession,
  type LeaveNoticeRule,
  normalizeNoticeRules,
  type NoticeEvaluation,
  PROGRAM_DIRECTOR_ROLE,
  resolveLeaveApprovers,
  type ResolvedApprovers,
} from "@/lib/studio/coach-leave";
import { wibNow } from "@/lib/studio/jobs";
import type { LeaveType } from "@/types/hris";

/**
 * Cuti & pengganti coach (EPIC-067) — query approver & pengaturan.
 * Approver dihitung per hari (WIB): Program Director yang sedang cuti HRIS
 * (disetujui) atau punya time-off coach hari ini tidak ikut memutus.
 */

export async function loadCoachLeaveSettings(branchId: string): Promise<CoachLeaveSettings> {
  const rows = await query<{ key: string; value: unknown }>(
    `SELECT key, value FROM studio.settings WHERE branch_id = $1 AND key LIKE 'leave\\_%'`,
    [branchId]
  );
  const out: CoachLeaveSettings = { ...DEFAULT_COACH_LEAVE_SETTINGS };
  for (const [field, key] of Object.entries(COACH_LEAVE_SETTING_KEYS) as [keyof CoachLeaveSettings, string][]) {
    const r = rows.find((x) => x.key === key);
    if (r) (out as unknown as Record<string, unknown>)[field] = r.value;
  }
  out.notice_rules = normalizeNoticeRules(out.notice_rules);
  return out;
}

export type CoachLeaveSettingsPatch = Partial<Omit<CoachLeaveSettings, "notice_rules">> & {
  /** Boleh sebagian (per jenis cuti & per kolom); digabung dengan aturan tersimpan. */
  notice_rules?: Partial<Record<LeaveType, Partial<LeaveNoticeRule>>>;
};

export async function saveCoachLeaveSettings(branchId: string, patch: CoachLeaveSettingsPatch, userId: string) {
  if (patch.notice_rules) {
    // Gabung per jenis cuti per kolom: field yang tidak dikirim tetap nilai tersimpan.
    const current = (await loadCoachLeaveSettings(branchId)).notice_rules;
    const merged: Record<string, LeaveNoticeRule> = { ...current };
    for (const [type, rule] of Object.entries(patch.notice_rules)) merged[type] = { ...current[type as LeaveType], ...rule };
    patch = { ...patch, notice_rules: normalizeNoticeRules(merged) };
  }
  for (const [field, value] of Object.entries(patch) as [keyof CoachLeaveSettings, unknown][]) {
    if (value === undefined) continue;
    await query(
      `INSERT INTO studio.settings (branch_id, key, value, updated_by) VALUES ($1, $2, $3::jsonb, $4)
       ON CONFLICT (branch_id, key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [branchId, COACH_LEAVE_SETTING_KEYS[field], JSON.stringify(value), userId]
    );
  }
  return loadCoachLeaveSettings(branchId);
}

/** Sedang cuti hari ini: cuti HRIS disetujui, atau time-off coach di venue ini. */
const ON_LEAVE_TODAY = `(
  EXISTS (
    SELECT 1 FROM hris.employees e JOIN hris.leaves l ON l.employee_id = e.id
    WHERE e.user_id = u.id AND l.status = 'approved'
      AND (now() AT TIME ZONE 'Asia/Jakarta')::date BETWEEN l.start_date AND l.end_date
  ) OR EXISTS (
    SELECT 1 FROM hris.employees e
    JOIN studio.coaches c ON c.employee_id = e.id
    JOIN studio.coach_time_off t ON t.coach_id = c.id
    WHERE e.user_id = u.id AND t.branch_id = $1
      AND (now() AT TIME ZONE 'Asia/Jakarta')::date BETWEEN t.date_from AND t.date_to
  )
)`;

/** User aktif dengan role Program Director (kolom role atau iam.user_roles), di venue ini atau tanpa scope cabang. */
export async function listProgramDirectors(branchId: string): Promise<ApproverCandidate[]> {
  return query<ApproverCandidate>(
    `SELECT u.id AS "userId", u.full_name AS name, ${ON_LEAVE_TODAY} AS "onLeave"
     FROM configuration.users u
     WHERE u.status = 'active'
       AND (u.branch_id IS NULL OR u.branch_id = $1)
       AND (u.role = $2 OR EXISTS (
         SELECT 1 FROM iam.user_roles ur JOIN iam.roles r ON r.id = ur.role_id
         WHERE ur.user_id = u.id AND r.code = $2 AND r.is_active AND r.deleted_at IS NULL
       ))
     ORDER BY u.full_name`,
    [branchId, PROGRAM_DIRECTOR_ROLE]
  );
}

async function loadCandidate(branchId: string, userId: string | null): Promise<ApproverCandidate | null> {
  if (!userId) return null;
  return queryOne<ApproverCandidate>(
    `SELECT u.id AS "userId", u.full_name AS name, ${ON_LEAVE_TODAY} AS "onLeave"
     FROM configuration.users u WHERE u.id = $2 AND u.status = 'active'`,
    [branchId, userId]
  );
}

export interface CoachLeaveApproverState {
  programDirectors: ApproverCandidate[];
  /** null bila belum diatur atau user cadangan sudah tidak aktif. */
  backup: ApproverCandidate | null;
  resolved: ResolvedApprovers;
}

export async function getCoachLeaveApprovers(branchId: string, requesterUserId?: string | null): Promise<CoachLeaveApproverState> {
  const settings = await loadCoachLeaveSettings(branchId);
  const [programDirectors, backup] = await Promise.all([
    listProgramDirectors(branchId),
    loadCandidate(branchId, settings.backup_approver_user_id),
  ]);
  return { programDirectors, backup, resolved: resolveLeaveApprovers({ programDirectors, backup, requesterUserId }) };
}

/** Lempar 403 bila user bukan approver cuti coach saat ini (dipakai alur persetujuan T-067-A4). */
export async function assertCanDecideCoachLeave(
  branchId: string,
  user: { id: string; role: string },
  requesterUserId?: string | null
): Promise<void> {
  const { resolved } = await getCoachLeaveApprovers(branchId, requesterUserId);
  if (!canDecideCoachLeave(user, resolved, requesterUserId)) {
    throw ApiError.forbidden(
      requesterUserId && user.id === requesterUserId
        ? "Tidak bisa memutus pengajuan sendiri"
        : "Hanya Program Director (atau approver cadangan saat Program Director tidak ada) yang bisa memutus"
    );
  }
}

/** Calon approver cadangan: user aktif yang bisa login ke backoffice di venue ini. */
export async function listBackupCandidates(branchId: string): Promise<{ id: string; name: string; role: string }[]> {
  return query(
    `SELECT u.id, u.full_name AS name, u.role
     FROM configuration.users u
     WHERE u.status = 'active' AND u.role NOT IN ('pos', 'employee')
       AND (u.branch_id IS NULL OR u.branch_id = $1)
     ORDER BY u.full_name`,
    [branchId]
  );
}

export interface CoachLeaveNotice {
  branchId: string;
  rule: LeaveNoticeRule;
  evaluation: NoticeEvaluation;
  /** Rentang blackout yang beririsan (kosong bila jenis cuti tidak terkena blackout). */
  blackouts: BlackoutPeriod[];
}

/**
 * Aturan H-N untuk pengajuan cuti karyawan yang terhubung ke coach aktif
 * (T-067-A1). null = bukan coach → aturan tidak berlaku (staf non-coach).
 */
export async function evaluateCoachLeaveNotice(
  employeeId: string,
  leaveType: LeaveType,
  startDate: string,
  endDate: string,
  now: Date = new Date()
): Promise<CoachLeaveNotice | null> {
  const coach = await queryOne<{ branch_id: string }>(
    `SELECT branch_id FROM studio.coaches WHERE employee_id = $1 AND is_active ORDER BY created_at LIMIT 1`,
    [employeeId]
  );
  if (!coach) return null;
  const { notice_rules } = await loadCoachLeaveSettings(coach.branch_id);
  const rule = notice_rules[leaveType];
  const blackouts = blackoutConflicts(rule, await listBlackoutsInRange(coach.branch_id, startDate, endDate), startDate, endDate);
  return { branchId: coach.branch_id, rule, evaluation: evaluateLeaveNotice(rule, startDate, wibNow(now).date), blackouts };
}

// ── Tanggal blackout (T-067-A2) ────────────────────────────────────────────

const BLACKOUT_COLS = `id, date_from::text AS date_from, date_to::text AS date_to, reason`;

export interface BlackoutRow extends BlackoutPeriod {
  created_by_name: string | null;
  created_at: string;
}

/** Blackout yang belum lewat (date_to ≥ hari ini WIB), urut tanggal. */
export async function listUpcomingBlackouts(branchId: string, now: Date = new Date()): Promise<BlackoutRow[]> {
  return query<BlackoutRow>(
    `SELECT b.id, b.date_from::text AS date_from, b.date_to::text AS date_to, b.reason, u.full_name AS created_by_name, b.created_at
     FROM studio.coach_leave_blackouts b LEFT JOIN configuration.users u ON u.id = b.created_by
     WHERE b.branch_id = $1 AND b.date_to >= $2::date
     ORDER BY b.date_from, b.date_to`,
    [branchId, wibNow(now).date]
  );
}

export async function listBlackoutsInRange(branchId: string, start: string, end: string): Promise<BlackoutPeriod[]> {
  return query<BlackoutPeriod>(
    `SELECT ${BLACKOUT_COLS} FROM studio.coach_leave_blackouts
     WHERE branch_id = $1 AND date_from <= $3::date AND date_to >= $2::date
     ORDER BY date_from`,
    [branchId, start, end]
  );
}

/** Cuti coach yang sudah disetujui / menunggu dan beririsan dengan rentang — ditampilkan saat blackout dibuat. */
export interface BlackoutOverlapLeave {
  leave_id: string;
  coach_name: string;
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  status: "pending" | "approved";
}

export async function createBlackout(
  venue: { companyId: string; branchId: string },
  userId: string,
  input: { date_from: string; date_to: string; reason: string }
): Promise<{ id: string; overlapping: BlackoutOverlapLeave[] }> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO studio.coach_leave_blackouts (company_id, branch_id, date_from, date_to, reason, created_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [venue.companyId, venue.branchId, input.date_from, input.date_to, input.reason.trim(), userId]
  );
  // Cuti yang sudah disetujui tidak dibatalkan otomatis; Program Director memutuskan sendiri.
  const overlapping = await query<BlackoutOverlapLeave>(
    `SELECT l.id AS leave_id, COALESCE(c.display_name, c.full_name) AS coach_name, l.leave_type,
            l.start_date::text AS start_date, l.end_date::text AS end_date, l.status
     FROM hris.leaves l JOIN studio.coaches c ON c.employee_id = l.employee_id AND c.is_active
     WHERE c.branch_id = $1 AND l.status IN ('pending', 'approved')
       AND l.start_date <= $3::date AND l.end_date >= $2::date
     ORDER BY l.start_date`,
    [venue.branchId, input.date_from, input.date_to]
  );
  return { id: row!.id, overlapping };
}

export async function deleteBlackout(branchId: string, id: string): Promise<void> {
  const rows = await query(`DELETE FROM studio.coach_leave_blackouts WHERE id = $1 AND branch_id = $2 RETURNING id`, [id, branchId]);
  if (rows.length === 0) throw ApiError.notFound("Tanggal blackout tidak ditemukan");
}

/** Blackout yang berlaku untuk cuti coach ini sekarang (dicek ulang saat persetujuan). */
export async function leaveBlackoutConflicts(leave: {
  branchId: string;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
}): Promise<BlackoutPeriod[]> {
  const { notice_rules } = await loadCoachLeaveSettings(leave.branchId);
  return blackoutConflicts(
    notice_rules[leave.leaveType],
    await listBlackoutsInRange(leave.branchId, leave.startDate, leave.endDate),
    leave.startDate,
    leave.endDate
  );
}

/**
 * Sesi terjadwal (kelas & Personal Training) milik coach di rentang tanggal —
 * yang butuh pengganti bila cutinya disetujui. Sesi selesai/batal tidak ikut.
 */
export async function listCoachSessionsInRange(coachId: string, start: string, end: string): Promise<ImpactedSession[]> {
  return query<ImpactedSession>(
    `SELECT s.id, s.session_date::text AS session_date, to_char(s.start_time,'HH24:MI') AS start_time,
            to_char(s.end_time,'HH24:MI') AS end_time, p.name AS program_name, p.kind AS program_kind,
            (SELECT COUNT(*) FROM studio.bookings b WHERE b.session_id = s.id AND b.status IN ('booked','attended'))::int AS booked_count
     FROM studio.class_sessions s
     JOIN studio.programs p ON p.id = s.program_id
     WHERE s.coach_id = $1 AND s.status = 'scheduled' AND s.session_date BETWEEN $2::date AND $3::date
     ORDER BY s.session_date, s.start_time`,
    [coachId, start, end]
  );
}

export interface CoachLeaveRow {
  id: string;
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  total_days: number;
  status: string;
  reason: string;
  rejection_reason: string | null;
  is_short_notice: boolean;
  notice_days: number | null;
  blackout_exception_requested: boolean;
  blackout_override_reason: string | null;
  created_at: string;
}

/** Riwayat pengajuan cuti coach (lewat karyawan yang tertaut ke profil coach). */
export async function listCoachLeaves(coachId: string, limit = 20): Promise<CoachLeaveRow[]> {
  return query<CoachLeaveRow>(
    `SELECT l.id, l.leave_type, l.start_date::text AS start_date, l.end_date::text AS end_date, l.total_days, l.status,
            l.reason, l.rejection_reason, l.is_short_notice, l.notice_days,
            l.blackout_exception_requested, l.blackout_override_reason, l.created_at
     FROM hris.leaves l JOIN studio.coaches c ON c.employee_id = l.employee_id
     WHERE c.id = $1
     ORDER BY l.created_at DESC
     LIMIT $2`,
    [coachId, limit]
  );
}
