import { query, queryOne } from "@/lib/db";
import { getWorkforceActor } from "@/lib/hris/workforce-auth";

/**
 * Task Departemen (permintaan owner 2026-08-30) — konsep MBO/task
 * compliance: departemen menyusun daftar tugas (rutin harian/mingguan/
 * bulanan atau sekali jalan), penanggung jawab menandai selesai, HRD
 * mereview (approve/reject), dan hasilnya dihitung sebagai indikator
 * KPI `task_completion`.
 *
 * Kemunculan (occurrence) dibuat MALAS: saat daftar dibuka utk suatu
 * rentang, kemunculan yang belum ada di-generate idempoten (ON CONFLICT
 * DO NOTHING) — tanpa cron, pola yang sama dengan auto-snapshot KPI.
 */

export type TaskRecurrence = "once" | "daily" | "weekly" | "monthly";

export interface DeptTaskRow {
  id: string;
  department_id: string;
  assignee_employee_id: string | null;
  title: string;
  recurrence: TaskRecurrence;
  weekly_day: number | null;
  monthly_day: number | null;
  due_date: string | null;
  is_active: boolean;
  /** Tanggal task dibuat (WIB) — task rutin tidak dijadwalkan sebelum tanggal ini. */
  created_date?: string | null;
}

/** Tanggal-tanggal kemunculan sebuah task dalam rentang [start..end] (WIB). */
export function occurrenceDatesFor(
  task: Pick<DeptTaskRow, "recurrence" | "weekly_day" | "monthly_day" | "due_date" | "created_date">,
  startIso: string,
  endIso: string
): string[] {
  const out: string[] = [];
  // Task rutin mulai berlaku sejak dibuat (EPIC-068): tanpa ini task harian yang
  // dibuat tgl 22 langsung punya 21 jadwal "terlambat" sejak tgl 1 yang ikut
  // dihitung KPI. Task sekali jalan tetap memakai tanggal jatuh tempo pilihan.
  if (task.recurrence !== "once" && task.created_date && task.created_date > startIso) {
    startIso = task.created_date;
  }
  const start = new Date(`${startIso}T00:00:00Z`);
  const end = new Date(`${endIso}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return out;
  }
  if (task.recurrence === "once") {
    if (task.due_date && task.due_date >= startIso && task.due_date <= endIso) {
      out.push(task.due_date);
    }
    return out;
  }
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    // getUTCDay: 0=Minggu..6=Sabtu → konversi ke 1=Senin..7=Minggu
    const dayOfWeek = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
    if (task.recurrence === "daily") out.push(iso);
    else if (task.recurrence === "weekly" && task.weekly_day === dayOfWeek) out.push(iso);
    else if (task.recurrence === "monthly" && task.monthly_day === d.getUTCDate()) out.push(iso);
  }
  return out;
}

/** Pastikan occurrence rentang [start..end] ada utk semua task aktif dept. */
export async function ensureOccurrences(
  departmentId: string,
  startIso: string,
  endIso: string
): Promise<void> {
  const tasks = await query<DeptTaskRow>(
    `SELECT id, department_id, assignee_employee_id, title, recurrence,
            weekly_day, monthly_day, due_date::text, is_active,
            (created_at AT TIME ZONE 'Asia/Jakarta')::date::text AS created_date
     FROM hris.department_tasks
     WHERE department_id = $1 AND is_active = true`,
    [departmentId]
  );
  const values: string[] = [];
  const params: unknown[] = [];
  for (const task of tasks) {
    for (const date of occurrenceDatesFor(task, startIso, endIso)) {
      params.push(task.id, date);
      values.push(`($${params.length - 1}, $${params.length}::date)`);
    }
  }
  if (values.length === 0) return;
  await query(
    `INSERT INTO hris.department_task_occurrences (task_id, occurrence_date)
     VALUES ${values.join(", ")}
     ON CONFLICT (task_id, occurrence_date) DO NOTHING`,
    params
  );
}

/**
 * Aktor Task Departemen: akun + departemen karyawannya + apakah atasan
 * (punya bawahan langsung aktif). HR melihat semua departemen; atasan
 * mengelola & mereview departemennya; anggota mengerjakan task-nya.
 */
export async function deptTaskActor() {
  const actor = await getWorkforceActor();
  if (!actor) return null;
  if (!actor.employeeId) {
    return { ...actor, departmentId: null as string | null, fullName: null as string | null, hasSubordinates: false };
  }
  const me = await queryOne<{
    department_id: string | null;
    full_name: string;
    subordinates: number;
  }>(
    `SELECT e.department_id, e.full_name,
            (SELECT count(*) FROM hris.employees s
             WHERE s.reporting_to = e.id AND s.is_active)::int AS subordinates
     FROM hris.employees e WHERE e.id = $1`,
    [actor.employeeId]
  );
  return {
    ...actor,
    departmentId: me?.department_id ?? null,
    fullName: me?.full_name ?? null,
    hasSubordinates: (me?.subordinates ?? 0) > 0,
  };
}
