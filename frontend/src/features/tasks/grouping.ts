import { isOpenStatus, type OccurrenceStatus, type TaskItem } from "./types";

/** Seksi daftar Tugas Saya, urutan tampil. */
export type ListSection = "overdue" | "today" | "upcoming" | "review" | "closed";

export const SECTION_LABEL: Record<ListSection, string> = {
  overdue: "Terlambat",
  today: "Hari ini",
  upcoming: "Mendatang",
  review: "Menunggu review",
  closed: "Selesai",
};

export const SECTION_ORDER: ListSection[] = ["overdue", "today", "upcoming", "review", "closed"];

/** Kelompokkan kemunculan: terlambat dulu, hari ini, mendatang, tunggu review, lalu disetujui. */
export function groupBySection(items: TaskItem[], today: string): Record<ListSection, TaskItem[]> {
  const out: Record<ListSection, TaskItem[]> = { overdue: [], today: [], upcoming: [], review: [], closed: [] };
  for (const t of items) {
    if (t.status === "approved") out.closed.push(t);
    else if (t.status === "done") out.review.push(t);
    else if (t.occurrence_date < today) out.overdue.push(t);
    else if (t.occurrence_date === today) out.today.push(t);
    else out.upcoming.push(t);
  }
  return out;
}

/** Kolom papan per status, urutan pending → in_progress → done → approved → rejected. */
export function groupByStatus(items: TaskItem[]): Record<OccurrenceStatus, TaskItem[]> {
  const out: Record<OccurrenceStatus, TaskItem[]> = { pending: [], in_progress: [], done: [], approved: [], rejected: [] };
  for (const t of items) out[t.status].push(t);
  return out;
}

/** Ringkasan header: terbuka, terlambat, menunggu review, disetujui. */
export function completionSummary(items: TaskItem[]): { open: number; overdue: number; review: number; approved: number } {
  let open = 0;
  let overdue = 0;
  let review = 0;
  let approved = 0;
  for (const t of items) {
    if (t.status === "approved") approved++;
    else if (t.status === "done") review++;
    else if (isOpenStatus(t.status)) {
      open++;
      if (t.overdue) overdue++;
    }
  }
  return { open, overdue, review, approved };
}

/** Persentase 0–100 dari rasio; null bila tidak ada data. */
export function ratePercent(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

/**
 * Aksi yang mewujudkan perpindahan kartu ke kolom tujuan, atau null bila
 * perpindahan itu tidak ada artinya (mis. ke kolom yang sama).
 */
export function actionForColumn(target: OccurrenceStatus, item: TaskItem): "start" | "done" | "approve" | "reject" | "reopen" | null {
  if (target === item.status) return null;
  switch (target) {
    case "in_progress":
      return "start";
    case "done":
      return item.review_required ? "done" : null;
    case "approved":
      return item.review_required ? "approve" : "done";
    case "rejected":
      return "reject";
    case "pending":
      return "reopen";
  }
}
