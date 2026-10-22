/**
 * Pemantauan Task Departemen (EPIC-068). Logika murni — query ada di
 * dept-task-monitor-server.ts. Satu baris = satu kemunculan (jadwal) task.
 *
 * Definisi:
 *  - jatuh tempo  = tanggal kemunculan ≤ hari ini (jadwal mendatang tidak dihitung);
 *  - terlambat    = jatuh tempo sebelum hari ini dan belum diselesaikan
 *                   (belum mulai, sedang dikerjakan, atau ditolak);
 *  - penyelesaian = disetujui ÷ jatuh tempo (sama dengan KPI task_completion);
 *  - progres      = rata-rata progres efektif kemunculan yang jatuh tempo.
 */

export type OccurrenceStatus = "pending" | "in_progress" | "done" | "approved" | "rejected";

export const OCCURRENCE_STATUS_LABEL: Record<OccurrenceStatus, string> = {
  pending: "Belum dimulai",
  in_progress: "Sedang dikerjakan",
  done: "Selesai — tunggu review",
  approved: "Disetujui",
  rejected: "Ditolak",
};

export interface MonitorOccurrence {
  occurrence_id: string;
  task_id: string;
  title: string;
  department_id: string;
  department_name: string;
  assignee_id: string | null;
  assignee_name: string | null;
  occurrence_date: string;
  status: OccurrenceStatus;
  /** Progres efektif 0–100 (lihat effectiveProgress). */
  progress: number;
  last_note: string | null;
  last_note_at: string | null;
}

/**
 * Progres efektif satu kemunculan:
 *  selesai / disetujui → 100; belum dimulai → 0; ditolak → maks 99 (perlu
 *  dikerjakan ulang); sedang dikerjakan → dari sub-task berbobot bila task
 *  punya sub-task, selain itu persentase yang diisi penanggung jawab.
 */
export function effectiveProgress(i: {
  status: OccurrenceStatus;
  manualPercent: number | null;
  subtaskPercent: number | null;
}): number {
  if (i.status === "done" || i.status === "approved") return 100;
  if (i.status === "pending") return 0;
  const raw = i.subtaskPercent ?? i.manualPercent ?? 0;
  return Math.max(0, Math.min(99, Math.round(raw)));
}

export function isOverdue(o: Pick<MonitorOccurrence, "occurrence_date" | "status">, today: string): boolean {
  return o.occurrence_date < today && (o.status === "pending" || o.status === "in_progress" || o.status === "rejected");
}

export interface MonitorSummary {
  scheduled: number;
  due: number;
  approved: number;
  waiting_review: number;
  in_progress: number;
  not_started: number;
  rejected: number;
  overdue: number;
  /** disetujui ÷ jatuh tempo (null bila belum ada yang jatuh tempo). */
  completion: number | null;
  /** rata-rata progres efektif yang jatuh tempo, 0–100 (null bila belum ada). */
  avg_progress: number | null;
}

export function summarize(list: MonitorOccurrence[], today: string): MonitorSummary {
  const due = list.filter((o) => o.occurrence_date <= today);
  const count = (s: OccurrenceStatus) => due.filter((o) => o.status === s).length;
  const approved = count("approved");
  return {
    scheduled: list.length,
    due: due.length,
    approved,
    waiting_review: count("done"),
    in_progress: count("in_progress"),
    not_started: count("pending"),
    rejected: count("rejected"),
    overdue: list.filter((o) => isOverdue(o, today)).length,
    completion: due.length ? approved / due.length : null,
    avg_progress: due.length ? Math.round(due.reduce((sum, o) => sum + o.progress, 0) / due.length) : null,
  };
}

export interface AssigneeSummary extends MonitorSummary {
  assignee_id: string | null;
  assignee_name: string;
}

export interface DepartmentSummary extends MonitorSummary {
  department_id: string;
  department_name: string;
  assignees: AssigneeSummary[];
}

/** Ringkasan per departemen + per penanggung jawab; departemen paling bermasalah (terlambat terbanyak) di atas. */
export function groupByDepartment(list: MonitorOccurrence[], today: string): DepartmentSummary[] {
  const byDept = new Map<string, MonitorOccurrence[]>();
  for (const o of list) byDept.set(o.department_id, [...(byDept.get(o.department_id) ?? []), o]);
  const out: DepartmentSummary[] = [];
  for (const [deptId, rows] of byDept) {
    const byAssignee = new Map<string, MonitorOccurrence[]>();
    for (const o of rows) {
      const key = o.assignee_id ?? "";
      byAssignee.set(key, [...(byAssignee.get(key) ?? []), o]);
    }
    const assignees: AssigneeSummary[] = [...byAssignee.entries()]
      .map(([key, items]) => ({
        assignee_id: key || null,
        assignee_name: key ? (items[0].assignee_name ?? "—") : "Departemen (tanpa PJ)",
        ...summarize(items, today),
      }))
      .sort((a, b) => b.overdue - a.overdue || a.assignee_name.localeCompare(b.assignee_name));
    out.push({ department_id: deptId, department_name: rows[0].department_name, ...summarize(rows, today), assignees });
  }
  return out.sort((a, b) => b.overdue - a.overdue || a.department_name.localeCompare(b.department_name));
}

/** Daftar kemunculan terlambat, paling lama dulu. */
export function overdueList(list: MonitorOccurrence[], today: string, limit = 50): MonitorOccurrence[] {
  return list
    .filter((o) => isOverdue(o, today))
    .sort((a, b) => a.occurrence_date.localeCompare(b.occurrence_date) || a.title.localeCompare(b.title))
    .slice(0, limit);
}

/** Selisih hari kalender (untuk "terlambat N hari"). */
export function daysLate(date: string, today: string): number {
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000);
}
