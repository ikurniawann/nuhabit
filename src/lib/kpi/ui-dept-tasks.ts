/**
 * Logika tampilan Task Departemen (tanpa React): pengelompokan, ringkasan
 * status, dan progres sub-task per kemunculan.
 */

interface OccurrenceLike {
  id: string;
  task_id: string;
  occurrence_date: string;
  status: "pending" | "done" | "approved" | "rejected";
}

interface SubtaskLike {
  id: string;
  task_id: string;
  weight: number | string;
}

interface CheckedLike {
  occurrence_id: string;
  subtask_id: string;
  is_checked: boolean;
  checked_by_name?: string | null;
  checked_at?: string | null;
}

/** Kelompokkan baris per task_id dengan urutan asli dipertahankan. */
export function groupByTask<T extends { task_id: string }>(rows: readonly T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const list = map.get(row.task_id) ?? [];
    list.push(row);
    map.set(row.task_id, list);
  }
  return map;
}

export type CheckedIndex = Map<string, { name: string | null; at: string | null }>;

export const checkedKey = (occurrenceId: string, subtaskId: string) => `${occurrenceId}:${subtaskId}`;

/** Indeks sub-task yang sudah diceklis (jejak audit siapa & kapan). */
export function indexChecked(items: readonly CheckedLike[]): CheckedIndex {
  const map: CheckedIndex = new Map();
  for (const item of items) {
    if (!item.is_checked) continue;
    map.set(checkedKey(item.occurrence_id, item.subtask_id), {
      name: item.checked_by_name ?? null,
      at: item.checked_at ?? null,
    });
  }
  return map;
}

/** Jumlah jadwal, yang menunggu review (done), dan yang disetujui. */
export function summarizeOccurrences(occurrences: readonly OccurrenceLike[]) {
  return {
    total: occurrences.length,
    waiting: occurrences.filter((o) => o.status === "done").length,
    approved: occurrences.filter((o) => o.status === "approved").length,
  };
}

/** Ada jadwal hari ini yang belum disetujui. */
export function hasOpenToday(occurrences: readonly OccurrenceLike[], todayIso: string): boolean {
  return occurrences.some((o) => o.occurrence_date === todayIso && o.status !== "approved");
}

/** Pending dan tanggalnya sudah lewat. */
export function isOverdue(occurrence: OccurrenceLike, todayIso: string): boolean {
  return occurrence.status === "pending" && occurrence.occurrence_date < todayIso;
}

/** Persen progres (jumlah bobot sub-task yang diceklis). */
export function subtaskProgress(
  occurrenceId: string,
  subtasks: readonly SubtaskLike[],
  checked: CheckedIndex
): number {
  return subtasks.reduce(
    (sum, st) => sum + (checked.has(checkedKey(occurrenceId, st.id)) ? Number(st.weight) : 0),
    0
  );
}
