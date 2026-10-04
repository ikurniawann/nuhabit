import { query } from "@/lib/db";

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
}

/** Tanggal-tanggal kemunculan sebuah task dalam rentang [start..end] (WIB). */
export function occurrenceDatesFor(
  task: Pick<DeptTaskRow, "recurrence" | "weekly_day" | "monthly_day" | "due_date">,
  startIso: string,
  endIso: string
): string[] {
  const out: string[] = [];
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
            weekly_day, monthly_day, due_date::text, is_active
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

const RECURRENCES: readonly TaskRecurrence[] = ["once", "daily", "weekly", "monthly"];
const MAX_SUBTASKS = 50;

/** Rentang tanggal satu bulan "YYYY-MM" → awal & akhir bulan (ISO). */
export function monthRange(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(lastDay).padStart(2, "0")}` };
}

/**
 * Sub-task (owner 2026-08-31): 100% task dibagi RATA otomatis tanpa input
 * bobot. Sisa pembulatan ditempel ke sub-task terakhir supaya totalnya
 * persis 100.00.
 */
export function splitSubtaskWeights(titles: readonly string[]): { title: string; weight: number }[] {
  if (titles.length === 0) return [];
  const rata = Math.floor((100 / titles.length) * 100) / 100;
  return titles.map((title, index) => ({
    title,
    weight:
      index === titles.length - 1
        ? Math.round((100 - rata * (titles.length - 1)) * 100) / 100
        : rata,
  }));
}

export interface DeptTaskInput {
  title?: string;
  description?: string | null;
  recurrence?: string;
  weekly_day?: number | string | null;
  monthly_day?: number | string | null;
  due_date?: string | null;
  subtasks?: { title?: string }[];
}

export interface NormalizedDeptTask {
  title: string;
  description: string | null;
  recurrence: TaskRecurrence;
  weeklyDay: number | null;
  monthlyDay: number | null;
  dueDate: string | null;
  subtasks: { title: string; weight: number }[];
}

/** Validasi + normalisasi isi task baru; return pesan galat (Indonesia) bila tidak valid. */
export function normalizeDeptTask(body: DeptTaskInput): NormalizedDeptTask | string {
  const title = String(body.title || "").trim();
  if (title.length < 3) return "Judul task minimal 3 karakter";
  const recurrence = String(body.recurrence || "once") as TaskRecurrence;
  if (!RECURRENCES.includes(recurrence)) return "Jenis pengulangan tidak dikenal";
  if (recurrence === "once" && !/^\d{4}-\d{2}-\d{2}$/.test(String(body.due_date || ""))) {
    return "Task sekali jalan membutuhkan tanggal jatuh tempo";
  }
  const weeklyDay = Number(body.weekly_day);
  if (recurrence === "weekly" && (!Number.isInteger(weeklyDay) || weeklyDay < 1 || weeklyDay > 7)) {
    return "Task mingguan membutuhkan hari (Senin–Minggu)";
  }
  const monthlyDay = Number(body.monthly_day);
  if (recurrence === "monthly" && (!Number.isInteger(monthlyDay) || monthlyDay < 1 || monthlyDay > 28)) {
    return "Task bulanan membutuhkan tanggal 1–28";
  }
  const subtitles = (body.subtasks ?? [])
    .map((subtask) => String(subtask.title || "").trim())
    .filter((subtitle) => subtitle.length > 0);
  if (subtitles.length > MAX_SUBTASKS) return `Maksimal ${MAX_SUBTASKS} sub-task`;

  return {
    title,
    description: body.description?.trim() || null,
    recurrence,
    weeklyDay: recurrence === "weekly" ? weeklyDay : null,
    monthlyDay: recurrence === "monthly" ? monthlyDay : null,
    dueDate: recurrence === "once" ? (body.due_date ?? null) : null,
    subtasks: splitSubtaskWeights(subtitles),
  };
}
