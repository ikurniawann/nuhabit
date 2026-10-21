import { ApiError } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { isValidPeriod, periodToDate, shiftPeriod } from "@/lib/studio/commission";
import {
  DISCIPLINE_SETTING_KEY,
  type DisciplineRules,
  INCIDENT_KIND_LABEL,
  type IncidentKind,
  monthDeductionPercent,
  normalizeDisciplineRules,
  warningLabel,
  warningProposal,
} from "@/lib/studio/coach-discipline";
import type { CoachLeaveContext } from "@/lib/studio/coach-cover-server";
import { assertCanDecideCoachLeave, getCoachLeaveApprovers } from "@/lib/studio/coach-leave-server";
import { VENUE_TODAY_SQL } from "@/lib/studio/pass-server";
import { sendStaffWa } from "@/lib/studio/staff-wa";

/**
 * Disiplin coach (EPIC-067 T-067-A8) — catatan pelanggaran, potongan komisi
 * per bulan, dan usulan SP ke Program Director. SP berlaku 6 bulan: level SP
 * berikutnya dihitung dari SP terbit dalam 180 hari terakhir.
 */

const SP_VALID_DAYS = 180;
const backofficeUrl = () => `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/dashboard/studio/coach-leave`;

// ── Aturan ─────────────────────────────────────────────────────────────────

export async function loadDisciplineRules(branchId: string): Promise<DisciplineRules> {
  const row = await queryOne<{ value: unknown }>(`SELECT value FROM studio.settings WHERE branch_id = $1 AND key = $2`, [branchId, DISCIPLINE_SETTING_KEY]);
  return normalizeDisciplineRules(row?.value);
}

export type DisciplineRulesPatch = Partial<Omit<DisciplineRules, "deduction_percent">> & {
  deduction_percent?: Partial<DisciplineRules["deduction_percent"]>;
};

export async function saveDisciplineRules(branchId: string, patch: DisciplineRulesPatch, userId: string): Promise<DisciplineRules> {
  const current = await loadDisciplineRules(branchId);
  const next = normalizeDisciplineRules({
    ...current,
    ...patch,
    deduction_percent: { ...current.deduction_percent, ...(patch.deduction_percent ?? {}) },
  });
  await query(
    `INSERT INTO studio.settings (branch_id, key, value, updated_by) VALUES ($1, $2, $3::jsonb, $4)
     ON CONFLICT (branch_id, key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [branchId, DISCIPLINE_SETTING_KEY, JSON.stringify(next), userId]
  );
  return next;
}

// ── Catatan pelanggaran ────────────────────────────────────────────────────

export interface IncidentInput {
  coach_id: string;
  kind: IncidentKind;
  occurred_on: string;
  session_id?: string | null;
  leave_id?: string | null;
  minutes_late?: number | null;
  note?: string | null;
}

/** Catat pelanggaran (snapshot potongan dari aturan saat ini), lalu cek usulan SP. null = sudah tercatat (cuti yang sama). */
export async function recordIncident(venue: { companyId: string; branchId: string }, actorId: string | null, input: IncidentInput): Promise<string | null> {
  const coach = await queryOne(`SELECT 1 FROM studio.coaches WHERE id = $1 AND branch_id = $2`, [input.coach_id, venue.branchId]);
  if (!coach) throw ApiError.notFound("Coach tidak ditemukan");
  if (input.session_id) {
    const s = await queryOne(`SELECT 1 FROM studio.class_sessions WHERE id = $1 AND branch_id = $2`, [input.session_id, venue.branchId]);
    if (!s) throw ApiError.notFound("Sesi tidak ditemukan");
  }
  if (input.kind === "late" && !input.minutes_late) throw ApiError.badRequest("Isi berapa menit terlambat");
  const rules = await loadDisciplineRules(venue.branchId);
  const row = await queryOne<{ id: string }>(
    `INSERT INTO studio.coach_incidents (company_id, branch_id, coach_id, kind, occurred_on, session_id, leave_id, minutes_late, note, deduction_percent, recorded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (leave_id) WHERE leave_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [
      venue.companyId, venue.branchId, input.coach_id, input.kind, input.occurred_on, input.session_id ?? null, input.leave_id ?? null,
      input.kind === "late" ? input.minutes_late : null, input.note?.trim() || null, rules.deduction_percent[input.kind], actorId,
    ]
  );
  if (row) await evaluateWarning(venue, input.coach_id, rules);
  return row?.id ?? null;
}

/** Cuti mendadak yang disetujui → pelanggaran otomatis (sekali per cuti). Program Director bisa membatalkannya. */
export async function recordShortNoticeLeaveIncident(ctx: CoachLeaveContext, noticeDays: number | null): Promise<void> {
  await recordIncident({ companyId: ctx.companyId, branchId: ctx.branchId }, null, {
    coach_id: ctx.coachId,
    kind: "short_notice_leave",
    occurred_on: ctx.startDate,
    leave_id: ctx.leaveId,
    note: noticeDays == null ? "Cuti mendadak" : noticeDays >= 0 ? `Cuti mendadak, diajukan H-${noticeDays}` : `Cuti mendadak, diajukan ${-noticeDays} hari setelah mulai`,
  });
}

export async function voidIncident(branchId: string, id: string, actorId: string, reason: string): Promise<void> {
  const rows = await query(
    `UPDATE studio.coach_incidents SET status = 'void', void_reason = $3, voided_by = $4, voided_at = now()
     WHERE id = $1 AND branch_id = $2 AND status = 'active' RETURNING id`,
    [id, branchId, reason.trim(), actorId]
  );
  if (rows.length === 0) throw ApiError.notFound("Catatan tidak ditemukan atau sudah dibatalkan");
}

export interface IncidentRow {
  id: string;
  coach_id: string;
  coach_name: string;
  kind: IncidentKind;
  occurred_on: string;
  minutes_late: number | null;
  note: string | null;
  deduction_percent: number;
  status: "active" | "void";
  void_reason: string | null;
  session_label: string | null;
  recorded_by_name: string | null;
  created_at: string;
}

export async function listIncidents(branchId: string, sinceDays = 120): Promise<IncidentRow[]> {
  return query<IncidentRow>(
    `SELECT i.id, i.coach_id, COALESCE(c.display_name, c.full_name) AS coach_name, i.kind, i.occurred_on::text AS occurred_on,
            i.minutes_late, i.note, i.deduction_percent::float8 AS deduction_percent, i.status, i.void_reason,
            CASE WHEN s.id IS NULL THEN NULL ELSE p.name || ' · ' || to_char(s.start_time, 'HH24:MI') END AS session_label,
            u.full_name AS recorded_by_name, i.created_at
     FROM studio.coach_incidents i
     JOIN studio.coaches c ON c.id = i.coach_id
     LEFT JOIN studio.class_sessions s ON s.id = i.session_id
     LEFT JOIN studio.programs p ON p.id = s.program_id
     LEFT JOIN configuration.users u ON u.id = i.recorded_by
     WHERE i.branch_id = $1 AND i.occurred_on >= ${VENUE_TODAY_SQL} - $2::int
     ORDER BY i.occurred_on DESC, i.created_at DESC`,
    [branchId, sinceDays]
  );
}

// ── Potongan komisi ────────────────────────────────────────────────────────

/** Potongan per coach (%) dari pelanggaran aktif di bulan periode, dibatasi maksimum aturan. */
export async function periodDeductions(branchId: string, period: string): Promise<Record<string, number>> {
  if (!isValidPeriod(period)) return {};
  const rules = await loadDisciplineRules(branchId);
  const rows = await query<{ coach_id: string; deduction_percent: number }>(
    `SELECT coach_id, deduction_percent::float8 AS deduction_percent FROM studio.coach_incidents
     WHERE branch_id = $1 AND status = 'active' AND occurred_on >= $2::date AND occurred_on < $3::date`,
    [branchId, periodToDate(period), periodToDate(shiftPeriod(period, 1))]
  );
  const byCoach = new Map<string, { deduction_percent: number }[]>();
  for (const r of rows) byCoach.set(r.coach_id, [...(byCoach.get(r.coach_id) ?? []), r]);
  const out: Record<string, number> = {};
  for (const [coachId, list] of byCoach) out[coachId] = monthDeductionPercent(list, rules.max_deduction_percent);
  return out;
}

// ── Usulan SP ──────────────────────────────────────────────────────────────

async function evaluateWarning(venue: { companyId: string; branchId: string }, coachId: string, rules: DisciplineRules): Promise<void> {
  const [incidents, warnings] = await Promise.all([
    query<{ id: string; occurred_on: string }>(
      `SELECT id, occurred_on::text AS occurred_on FROM studio.coach_incidents
       WHERE coach_id = $1 AND status = 'active' AND occurred_on >= ${VENUE_TODAY_SQL} - $2::int ORDER BY occurred_on`,
      [coachId, rules.warning_window_days]
    ),
    query<{ level: number; status: string; incident_ids: string[]; decided_at: string | null }>(
      `SELECT level, status, incident_ids, decided_at FROM studio.coach_warnings WHERE coach_id = $1`,
      [coachId]
    ),
  ]);
  const covered = new Set(warnings.flatMap((w) => w.incident_ids));
  const validSince = Date.now() - SP_VALID_DAYS * 86_400_000;
  const lastIssuedLevel = Math.max(0, ...warnings.filter((w) => w.status === "issued" && w.decided_at && new Date(w.decided_at).getTime() >= validSince).map((w) => w.level));
  const proposal = warningProposal({
    incidents,
    coveredIncidentIds: covered,
    lastIssuedLevel,
    hasOpenProposal: warnings.some((w) => w.status === "proposed"),
    threshold: rules.warning_threshold,
  });
  if (!proposal) return;
  const created = await queryOne<{ id: string }>(
    `INSERT INTO studio.coach_warnings (company_id, branch_id, coach_id, level, window_from, window_to, incident_ids)
     VALUES ($1, $2, $3, $4, ${VENUE_TODAY_SQL} - $5::int, ${VENUE_TODAY_SQL}, $6::uuid[])
     ON CONFLICT (coach_id) WHERE status = 'proposed' DO NOTHING RETURNING id`,
    [venue.companyId, venue.branchId, coachId, proposal.level, rules.warning_window_days, proposal.incident_ids]
  );
  if (created) void notifyWarningProposal(venue.branchId, coachId, created.id, proposal.level, proposal.incident_ids.length, rules.warning_window_days);
}

async function notifyWarningProposal(branchId: string, coachId: string, warningId: string, level: number, count: number, windowDays: number) {
  try {
    const coach = await queryOne<{ name: string; user_id: string | null }>(
      `SELECT COALESCE(c.display_name, c.full_name) AS name, e.user_id FROM studio.coaches c LEFT JOIN hris.employees e ON e.id = c.employee_id WHERE c.id = $1`,
      [coachId]
    );
    if (!coach) return;
    const { resolved } = await getCoachLeaveApprovers(branchId, coach.user_id);
    for (const a of resolved.approvers) {
      const emp = await queryOne<{ phone: string | null }>(`SELECT phone FROM hris.employees WHERE user_id = $1 LIMIT 1`, [a.userId]);
      await sendStaffWa(
        "coach_discipline",
        `warning:${warningId}:${a.userId}`,
        emp?.phone ?? null,
        [`NüHabit — Usulan ${warningLabel(level)}`, `Coach ${coach.name}: ${count} pelanggaran dalam ${windowDays} hari terakhir.`, "", `Tinjau & putuskan: ${backofficeUrl()}`].join("\n")
      );
    }
  } catch (err) {
    console.error("[coach-discipline] notifikasi usulan SP gagal:", err);
  }
}

export interface WarningRow {
  id: string;
  coach_id: string;
  coach_name: string;
  level: number;
  status: "proposed" | "issued" | "dismissed";
  window_from: string;
  window_to: string;
  incident_count: number;
  incident_summary: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
}

export async function listWarnings(branchId: string): Promise<WarningRow[]> {
  const rows = await query<Omit<WarningRow, "incident_summary"> & { incidents: { d: string; k: IncidentKind }[] | null }>(
    `SELECT w.id, w.coach_id, COALESCE(c.display_name, c.full_name) AS coach_name, w.level, w.status,
            w.window_from::text AS window_from, w.window_to::text AS window_to, cardinality(w.incident_ids) AS incident_count,
            (SELECT json_agg(json_build_object('d', to_char(i.occurred_on, 'DD/MM'), 'k', i.kind) ORDER BY i.occurred_on)
               FROM studio.coach_incidents i WHERE i.id = ANY(w.incident_ids)) AS incidents,
            u.full_name AS decided_by_name, w.decided_at, w.decision_note, w.created_at
     FROM studio.coach_warnings w JOIN studio.coaches c ON c.id = w.coach_id
     LEFT JOIN configuration.users u ON u.id = w.decided_by
     WHERE w.branch_id = $1
     ORDER BY CASE w.status WHEN 'proposed' THEN 0 ELSE 1 END, w.created_at DESC
     LIMIT 100`,
    [branchId]
  );
  return rows.map(({ incidents, ...w }) => ({
    ...w,
    incident_summary: incidents?.map((i) => `${i.d} ${INCIDENT_KIND_LABEL[i.k]}`).join(", ") ?? null,
  }));
}

/** Program Director menerbitkan atau mengabaikan usulan SP. */
export async function decideWarning(branchId: string, id: string, actor: { id: string; role: string }, decision: "issued" | "dismissed", note?: string | null) {
  const w = await queryOne<{ status: string; user_id: string | null }>(
    `SELECT w.status, e.user_id FROM studio.coach_warnings w
     JOIN studio.coaches c ON c.id = w.coach_id LEFT JOIN hris.employees e ON e.id = c.employee_id
     WHERE w.id = $1 AND w.branch_id = $2`,
    [id, branchId]
  );
  if (!w) throw ApiError.notFound("Usulan SP tidak ditemukan");
  if (w.status !== "proposed") throw ApiError.conflict("Usulan SP ini sudah diputuskan");
  await assertCanDecideCoachLeave(branchId, actor, w.user_id);
  if (decision === "dismissed" && !note?.trim()) throw ApiError.badRequest("Isi alasan mengabaikan usulan SP");
  await query(
    `UPDATE studio.coach_warnings SET status = $3, decided_by = $4, decided_at = now(), decision_note = $5 WHERE id = $1 AND branch_id = $2 AND status = 'proposed'`,
    [id, branchId, decision, actor.id, note?.trim() || null]
  );
}
