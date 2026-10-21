import { ApiError } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import {
  type ApproverCandidate,
  canDecideCoachLeave,
  COACH_LEAVE_SETTING_KEYS,
  type CoachLeaveSettings,
  DEFAULT_COACH_LEAVE_SETTINGS,
  PROGRAM_DIRECTOR_ROLE,
  resolveLeaveApprovers,
  type ResolvedApprovers,
} from "@/lib/studio/coach-leave";

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
  return out;
}

export async function saveCoachLeaveSettings(branchId: string, patch: Partial<CoachLeaveSettings>, userId: string) {
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
