import "server-only";
/**
 * EPIC-050 Fase 4 — report tersimpan (T-4.1) dan report terjadwal (T-4.3):
 * daftar, buat, ubah, hapus, plus aturan siapa yang boleh mengubah.
 */
import { ApiError, type ApiUser } from "@/lib/api/auth";
import type { UserScope } from "@/lib/api/scope";
import { query, queryOne } from "@/lib/db";
import { scopedCompanyId } from "./guards";
import type { ReportInput } from "./report-builder";
import {
  canManageShared,
  loadAccessibleReport,
  reportVisibilityWhere,
  type SavedReportRow,
} from "./report-builder-server";
import { computeNextRun, type ReportScheduleInput } from "./report-schedule";

// ── Report tersimpan ───────────────────────────────────────────────────────

export function listSavedReports(user: ApiUser, scope: UserScope | null, dataset: string | null) {
  const params: unknown[] = [];
  const visibility = reportVisibilityWhere("r", user, scope, params);
  let extra = "";
  if (dataset) {
    params.push(dataset);
    extra = ` AND r.dataset = $${params.length}`;
  }
  return query(
    `SELECT r.id, r.company_id, r.name, r.description, r.dataset, r.definition, r.is_shared,
            r.created_by, r.created_at, r.updated_at, u.full_name AS creator_name,
            (SELECT COUNT(*) FROM crm.crm_report_schedules s WHERE s.report_id = r.id AND s.is_active) AS active_schedules
     FROM crm.crm_reports r
     LEFT JOIN configuration.users u ON u.id = r.created_by
     WHERE r.deleted_at IS NULL AND ${visibility}${extra}
     ORDER BY r.updated_at DESC`,
    params
  );
}

/** Report bersama hanya boleh dibuat/ditandai oleh admin; selain itu jadi privat. */
const sharedFlag = (requested: boolean, user: ApiUser) => (requested && !canManageShared(user) ? false : requested);

export function createSavedReport(user: ApiUser, scope: UserScope | null, b: ReportInput) {
  return queryOne(
    `INSERT INTO crm.crm_reports (company_id, name, description, dataset, definition, is_shared, created_by)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
     RETURNING id, name, dataset, is_shared`,
    [scopedCompanyId(user, scope), b.name, b.description ?? null, b.definition.dataset, JSON.stringify(b.definition), sharedFlag(b.is_shared, user), user.id]
  );
}

/** Report yang boleh dilihat user; 404 bila tidak ada/tak berhak. */
export async function requireAccessibleReport(id: string, user: ApiUser, scope: UserScope | null): Promise<SavedReportRow> {
  const report = await loadAccessibleReport(id, user, scope);
  if (!report) throw ApiError.notFound("Report tidak ditemukan");
  return report;
}

/** Hanya pembuat atau admin yang boleh mengubah/menghapus report. */
export async function requireEditableReport(
  id: string,
  user: ApiUser,
  scope: UserScope | null,
  verb: "mengubah" | "menghapus"
): Promise<SavedReportRow> {
  const report = await requireAccessibleReport(id, user, scope);
  const canEdit = report.created_by === user.id || user.role === "super_admin" || user.role === "admin";
  if (!canEdit) throw ApiError.forbidden(`Hanya pembuat atau admin yang bisa ${verb} report ini`);
  return report;
}

export function updateSavedReport(id: string, user: ApiUser, b: Partial<ReportInput>) {
  const sets: string[] = ["updated_at = now()"];
  const values: unknown[] = [];
  const push = (col: string, v: unknown, cast = "") => { values.push(v); sets.push(`${col} = $${values.length}${cast}`); };
  if (b.name !== undefined) push("name", b.name);
  if (b.description !== undefined) push("description", b.description ?? null);
  if (b.definition !== undefined) { push("definition", JSON.stringify(b.definition), "::jsonb"); push("dataset", b.definition.dataset); }
  if (b.is_shared !== undefined) push("is_shared", sharedFlag(b.is_shared, user));
  if (values.length === 0) throw ApiError.badRequest("Tidak ada field yang diubah");
  values.push(id);
  return queryOne(
    `UPDATE crm.crm_reports SET ${sets.join(", ")} WHERE id = $${values.length} AND deleted_at IS NULL
     RETURNING id, name, dataset, is_shared`,
    values
  );
}

export async function softDeleteReport(id: string): Promise<void> {
  await queryOne(`UPDATE crm.crm_reports SET deleted_at = now() WHERE id = $1 RETURNING id`, [id]);
}

// ── Report terjadwal ───────────────────────────────────────────────────────

interface ScheduleRow {
  id: string; company_id: string | null; frequency: "daily" | "weekly" | "monthly";
  hour: number; day_of_week: number | null; day_of_month: number | null; is_active: boolean;
}

/** Hanya admin/super admin yang mengelola jadwal (laporan dikirim ke banyak penerima). */
export function assertCanManageSchedules(user: ApiUser, action: string): void {
  if (!canManageShared(user)) throw ApiError.forbidden(`Hanya admin yang bisa ${action}`);
}

export function listReportSchedules(scope: UserScope | null) {
  const params: unknown[] = [];
  let where = "TRUE";
  if (scope?.companyId) {
    params.push(scope.companyId);
    where = `(s.company_id IS NULL OR s.company_id = $${params.length})`;
  }
  return query(
    `SELECT s.id, s.company_id, s.report_id, s.name, s.frequency, s.hour, s.day_of_week, s.day_of_month,
            s.channel, s.recipients, s.is_active, s.last_run_at, s.last_status, s.last_error, s.next_run_at,
            s.created_at, r.name AS report_name, r.dataset
     FROM crm.crm_report_schedules s
     JOIN crm.crm_reports r ON r.id = s.report_id AND r.deleted_at IS NULL
     WHERE ${where}
     ORDER BY s.is_active DESC, s.next_run_at NULLS LAST`,
    params
  );
}

export async function createReportSchedule(user: ApiUser, scope: UserScope | null, b: ReportScheduleInput) {
  await requireAccessibleReport(b.report_id, user, scope);
  return queryOne(
    `INSERT INTO crm.crm_report_schedules
       (company_id, report_id, name, frequency, hour, day_of_week, day_of_month, channel, recipients, is_active, next_run_at, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12)
     RETURNING id, name, frequency, next_run_at`,
    [scopedCompanyId(user, scope), b.report_id, b.name, b.frequency, b.hour, b.day_of_week ?? null, b.day_of_month ?? null,
     b.channel, JSON.stringify(b.recipients), b.is_active, b.is_active ? computeNextRun(b) : null, user.id]
  );
}

/** Jadwal di scope company user; 404 bila tidak ada. */
export async function requireSchedule(id: string, scope: UserScope | null): Promise<ScheduleRow> {
  const params: unknown[] = [id];
  let where = "id = $1";
  if (scope?.companyId) {
    params.push(scope.companyId);
    where += ` AND (company_id IS NULL OR company_id = $${params.length})`;
  }
  const row = await queryOne<ScheduleRow>(
    `SELECT id, company_id, frequency, hour, day_of_week, day_of_month, is_active FROM crm.crm_report_schedules WHERE ${where}`,
    params
  );
  if (!row) throw ApiError.notFound("Jadwal tidak ditemukan");
  return row;
}

export function updateReportSchedule(current: ScheduleRow, b: Partial<ReportScheduleInput>) {
  const sets: string[] = ["updated_at = now()"];
  const values: unknown[] = [];
  const push = (col: string, v: unknown, cast = "") => { values.push(v); sets.push(`${col} = $${values.length}${cast}`); };
  if (b.name !== undefined) push("name", b.name);
  if (b.frequency !== undefined) push("frequency", b.frequency);
  if (b.hour !== undefined) push("hour", b.hour);
  if (b.day_of_week !== undefined) push("day_of_week", b.day_of_week ?? null);
  if (b.day_of_month !== undefined) push("day_of_month", b.day_of_month ?? null);
  if (b.channel !== undefined) push("channel", b.channel);
  if (b.recipients !== undefined) push("recipients", JSON.stringify(b.recipients), "::jsonb");
  if (b.is_active !== undefined) push("is_active", b.is_active);
  if (values.length === 0) throw ApiError.badRequest("Tidak ada field yang diubah");
  // Waktu jalan berikutnya dihitung ulang bila pola atau status aktif berubah.
  const next = { ...current, ...b };
  push("next_run_at", next.is_active ? computeNextRun(next) : null);
  values.push(current.id);
  return queryOne(
    `UPDATE crm.crm_report_schedules SET ${sets.join(", ")} WHERE id = $${values.length}
     RETURNING id, name, frequency, is_active, next_run_at`,
    values
  );
}

export async function deleteReportSchedule(id: string): Promise<void> {
  await query(`DELETE FROM crm.crm_report_schedules WHERE id = $1`, [id]);
}
