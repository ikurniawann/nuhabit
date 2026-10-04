import { createServerPgClient } from "@/lib/pg/create-client";
import { ANNOUNCEMENT_SANITIZE_CONFIG } from "@/lib/hris/announcements";

/**
 * Kebijakan akses & status modul Logbook Department (EPIC-009).
 * Helper murni di file ini diuji unit; route hanya merangkainya.
 */

/** Boleh melihat & mengelola logbook SEMUA department. */
export const LOGBOOK_FULL_ACCESS_ROLES = [
  "super_admin",
  "admin",
  "hrd",
] as const;

/**
 * Boleh Review/Reject entry. Keputusan owner 2026-07-18: super_admin + hrd;
 * disiapkan mudah diperluas ke head department lain nanti: cukup tambah
 * role di sini (atau ganti ke pengecekan berbasis department bila sudah ada
 * role head dept formal).
 */
export const LOGBOOK_REVIEW_ROLES = ["super_admin", "hrd"] as const;

/** Allowlist sanitasi notes checklist: samakan dgn pengumuman agar konsisten. */
export const LOGBOOK_NOTE_SANITIZE_CONFIG = ANNOUNCEMENT_SANITIZE_CONFIG;

export type LogbookEntryStatus = "draft" | "submitted" | "reviewed" | "rejected";

export function hasFullLogbookAccess(role: string): boolean {
  return (LOGBOOK_FULL_ACCESS_ROLES as readonly string[]).includes(role);
}

export function canReviewLogbook(role: string): boolean {
  return (LOGBOOK_REVIEW_ROLES as readonly string[]).includes(role);
}

/** Submit hanya dari draft. */
export function canSubmitEntry(status: string): boolean {
  return status === "draft";
}

/** Review/Reject hanya dari submitted. */
export function canReviewEntry(status: string): boolean {
  return status === "submitted";
}

/** Entry hanya boleh dihapus selagi draft. */
export function canDeleteEntry(status: string): boolean {
  return status === "draft";
}

/** Item checklist hanya boleh diubah selagi entry-nya draft. */
export function canEditEntryItems(status: string): boolean {
  return status === "draft";
}

export interface LogbookActor {
  userId: string;
  role: string;
  /** id hris.employees yang tertaut; null utk akun non-karyawan */
  employeeId: string | null;
  /** department karyawan yang tertaut; null bila tidak ada */
  departmentId: string | null;
  isFullAccess: boolean;
  canReview: boolean;
}

export interface DepartmentScope {
  /** true bila permintaan diizinkan */
  allowed: boolean;
  /**
   * Filter department yang WAJIB dipakai query (null = tanpa filter,
   * hanya utk full-access).
   */
  departmentId: string | null;
}

/**
 * Resolusi scope department server-side:
 * - full-access: bebas (boleh minta department tertentu atau semua);
 * - selainnya: dikunci ke department sendiri; permintaan department lain
 *   ditolak, tanpa department karyawan → ditolak.
 */
export function resolveDepartmentScope(
  actor: Pick<LogbookActor, "isFullAccess" | "departmentId">,
  requestedDepartmentId: string | null | undefined
): DepartmentScope {
  if (actor.isFullAccess) {
    return { allowed: true, departmentId: requestedDepartmentId || null };
  }
  if (!actor.departmentId) return { allowed: false, departmentId: null };
  if (requestedDepartmentId && requestedDepartmentId !== actor.departmentId) {
    return { allowed: false, departmentId: null };
  }
  return { allowed: true, departmentId: actor.departmentId };
}

/** Aktor logbook dari sesi login; null bila tidak terautentikasi. */
export async function getLogbookActor(): Promise<LogbookActor | null> {
  const db = await createServerPgClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return null;

  const [{ data: userData }, { data: employee }] = await Promise.all([
    db.from("users").select("role").eq("id", user.id).single(),
    db
      .from("employees")
      .select("id, department_id")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  const role: string = userData?.role ?? "";
  return {
    userId: user.id,
    role,
    employeeId: employee?.id ?? null,
    departmentId: employee?.department_id ?? null,
    isFullAccess: hasFullLogbookAccess(role),
    canReview: canReviewLogbook(role),
  };
}

/** Batas panjang teks bebas (notes/review_notes). */
export const LOGBOOK_NOTE_MAX_LENGTH = 20_000;

/**
 * Normalisasi teks bebas notes/review_notes: kosong → null; bukan string
 * atau melebihi batas → `{ ok: false }`.
 */
export function normalizeLogbookNote(
  raw: unknown
): { ok: true; value: string | null } | { ok: false } {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== "string" || raw.length > LOGBOOK_NOTE_MAX_LENGTH) return { ok: false };
  return { ok: true, value: raw || null };
}

/**
 * Bobot item template: bobot 0 eksplisit (item "tidak dinilai") dipertahankan;
 * hanya nilai kosong/tak valid yang di-default-kan ke 1, negatif jadi 0.
 */
export function templateItemWeight(weight: unknown): number {
  if (weight === undefined || weight === null || !Number.isFinite(Number(weight))) return 1;
  return Math.max(0, Number(weight));
}

export interface LogbookSummaryEntry {
  department_id: string;
  department: unknown;
  status: string;
  completion_percentage: number | string | null;
  kpi_score: number | string | null;
}

export interface LogbookDepartmentSummary {
  department: unknown;
  total_entries: number;
  submitted_entries: number;
  reviewed_entries: number;
  avg_completion: number;
  avg_kpi_score: number;
}

const avg2 = (sum: number, count: number) => (count ? Number((sum / count).toFixed(2)) : 0);

/** Ringkasan per department: jumlah entry per status + rata-rata completion & KPI. */
export function summarizeLogbookEntries(entries: LogbookSummaryEntry[]): LogbookDepartmentSummary[] {
  const byDepartment = new Map<string, LogbookDepartmentSummary>();
  for (const entry of entries) {
    let row = byDepartment.get(entry.department_id);
    if (!row) {
      row = {
        department: entry.department,
        total_entries: 0,
        submitted_entries: 0,
        reviewed_entries: 0,
        avg_completion: 0,
        avg_kpi_score: 0,
      };
      byDepartment.set(entry.department_id, row);
    }
    row.total_entries += 1;
    if (entry.status === "submitted") row.submitted_entries += 1;
    if (entry.status === "reviewed") row.reviewed_entries += 1;
    row.avg_completion += Number(entry.completion_percentage || 0);
    row.avg_kpi_score += Number(entry.kpi_score || 0);
  }
  return [...byDepartment.values()].map((row) => ({
    ...row,
    avg_completion: avg2(row.avg_completion, row.total_entries),
    avg_kpi_score: avg2(row.avg_kpi_score, row.total_entries),
  }));
}
