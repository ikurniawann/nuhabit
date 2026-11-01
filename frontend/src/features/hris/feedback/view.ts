/** Logika tampilan Feedback 360° (tanpa React). */
import { toScore } from "@/lib/kpi/ui-performance";
import type {
  FeedbackApprovalResponse,
  FeedbackAssignment,
  FeedbackAssignmentPayload,
  FeedbackAssignmentStatus,
  FeedbackCategory,
  FeedbackCycle,
  FeedbackCyclePayload,
  FeedbackCycleStatus,
  FeedbackRelationship,
  FeedbackSummary,
  MyFeedbackAnswer,
  MyFeedbackSavePayload,
} from "./types";

type BadgeVariant = "success" | "warning" | "info" | "destructive" | "muted";

export const CYCLE_STATUSES: { value: FeedbackCycleStatus; label: string; variant: BadgeVariant }[] = [
  { value: "draft", label: "Draf", variant: "muted" },
  { value: "active", label: "Aktif", variant: "success" },
  { value: "closed", label: "Ditutup", variant: "info" },
];

export function cycleStatusMeta(status: string | null) {
  return CYCLE_STATUSES.find((s) => s.value === status) ?? CYCLE_STATUSES[0];
}

export const ASSIGNMENT_STATUS: Record<FeedbackAssignmentStatus, { label: string; variant: BadgeVariant }> = {
  pending: { label: "Belum mulai", variant: "muted" },
  in_progress: { label: "Sedang diisi", variant: "warning" },
  submitted: { label: "Terkirim", variant: "info" },
  approved: { label: "Disetujui", variant: "success" },
  rejected: { label: "Dikembalikan", variant: "destructive" },
};

/** Jenis hubungan penilai yang dipakai backend (feedback_relationship_types). */
export const RELATIONSHIPS: { value: FeedbackRelationship; label: string }[] = [
  { value: "self", label: "Diri sendiri" },
  { value: "manager", label: "Atasan" },
  { value: "peer", label: "Rekan setara" },
  { value: "subordinate", label: "Bawahan" },
  { value: "external", label: "Eksternal" },
];

export const relationshipLabel = (value: string) =>
  RELATIONSHIPS.find((r) => r.value === value)?.label ?? value;

/** "2026-10-01T00:00:00.000Z" → "2026-10-01" untuk input type=date. */
const dateInput = (value: string | null | undefined) => (value ? value.slice(0, 10) : "");

/** Bobot nilai akhir siklus; kolom kosong memakai default 70/30. */
export function cycleWeights(cycle: Pick<FeedbackCycle, "kpi_weight" | "feedback_weight"> | null) {
  return { kpi: toScore(cycle?.kpi_weight ?? null) ?? 70, feedback: toScore(cycle?.feedback_weight ?? null) ?? 30 };
}

export function cycleProgress(cycle: Pick<FeedbackCycle, "assignments_count" | "completed_count">) {
  const total = cycle.assignments_count[0]?.count ?? 0;
  const done = cycle.completed_count ?? 0;
  return { done, total, percent: total ? Math.round((done / total) * 100) : 0 };
}

/** Jumlah penugasan per status untuk ringkasan progres siklus. */
export function assignmentStats(rows: readonly Pick<FeedbackAssignment, "status">[]) {
  const counts: Record<FeedbackAssignmentStatus, number> = {
    pending: 0,
    in_progress: 0,
    submitted: 0,
    approved: 0,
    rejected: 0,
  };
  for (const row of rows) counts[row.status] = (counts[row.status] ?? 0) + 1;
  return counts;
}

// ── Form siklus ──

export interface CycleForm {
  name: string;
  period_label: string;
  start_date: string;
  end_date: string;
  status: FeedbackCycleStatus;
  kpi_weight: string;
  feedback_weight: string;
  is_anonymous: boolean;
  allow_self_assessment: boolean;
  require_manager_review: boolean;
}

export function cycleToForm(cycle: FeedbackCycle | null): CycleForm {
  const weights = cycleWeights(cycle);
  return {
    name: cycle?.name ?? "",
    period_label: cycle?.period_label ?? "",
    start_date: dateInput(cycle?.start_date),
    end_date: dateInput(cycle?.end_date),
    status: cycleStatusMeta(cycle?.status ?? "draft").value,
    kpi_weight: String(weights.kpi),
    feedback_weight: String(weights.feedback),
    is_anonymous: cycle?.is_anonymous ?? true,
    allow_self_assessment: cycle?.allow_self_assessment ?? true,
    require_manager_review: cycle?.require_manager_review ?? true,
  };
}

/** Pesan galat pertama, atau null bila form siap dikirim. */
export function validateCycleForm(form: CycleForm): string | null {
  if (!form.name.trim()) return "Nama siklus wajib diisi";
  if (!form.period_label.trim()) return "Label periode wajib diisi";
  if (!form.start_date || !form.end_date) return "Tanggal mulai dan selesai wajib diisi";
  if (form.end_date < form.start_date) return "Tanggal selesai harus setelah tanggal mulai";
  const kpi = Number(form.kpi_weight);
  const feedback = Number(form.feedback_weight);
  if (![kpi, feedback].every((w) => Number.isFinite(w) && w >= 0 && w <= 100)) return "Bobot harus 0 sampai 100";
  if (kpi + feedback !== 100) return "Bobot KPI dan Feedback 360° harus berjumlah 100";
  return null;
}

export function toCyclePayload(form: CycleForm): FeedbackCyclePayload {
  return {
    ...form,
    name: form.name.trim(),
    period_label: form.period_label.trim(),
    kpi_weight: Number(form.kpi_weight),
    feedback_weight: Number(form.feedback_weight),
  };
}

// ── Form penugasan ──

export interface ReviewerRow {
  relationship: FeedbackRelationship;
  reviewer_id: string;
}

export interface AssignForm {
  employee_id: string;
  include_self: boolean;
  reviewers: ReviewerRow[];
  due_date: string;
}

export const emptyAssignForm = (): AssignForm => ({
  employee_id: "",
  include_self: true,
  reviewers: [{ relationship: "manager", reviewer_id: "" }],
  due_date: "",
});

/**
 * Baris POST /feedback-assignments dari form: penilaian diri (bila dipilih)
 * plus tiap penilai, tanpa duplikat. Melempar Error berpesan bila tidak valid.
 */
export function buildAssignments(cycleId: string, form: AssignForm, allowSelf: boolean): FeedbackAssignmentPayload[] {
  if (!form.employee_id) throw new Error("Pilih karyawan yang dinilai");
  const due = form.due_date || null;
  const rows: FeedbackAssignmentPayload[] = [];
  const seen = new Set<string>();
  const push = (relationship: FeedbackRelationship, reviewerId: string) => {
    const key = `${relationship}:${reviewerId}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({ cycle_id: cycleId, employee_id: form.employee_id, reviewer_id: reviewerId, relationship_type: relationship, due_date: due });
  };
  if (form.include_self && allowSelf) push("self", form.employee_id);
  for (const row of form.reviewers) {
    if (!row.reviewer_id) continue;
    if (row.relationship === "self") throw new Error("Penilaian diri diatur lewat sakelar di atas");
    if (row.reviewer_id === form.employee_id) throw new Error("Penilai tidak boleh sama dengan karyawan yang dinilai");
    push(row.relationship, row.reviewer_id);
  }
  if (rows.length === 0) throw new Error("Tambahkan minimal satu penilai");
  return rows;
}

// ── Hasil ──

export const SUMMARY_CATEGORIES = [
  { key: "leadership_score", label: "Kepemimpinan" },
  { key: "communication_score", label: "Komunikasi" },
  { key: "collaboration_score", label: "Kolaborasi" },
  { key: "accountability_score", label: "Akuntabilitas" },
  { key: "problem_solving_score", label: "Pemecahan Masalah" },
] as const satisfies readonly { key: keyof FeedbackSummary; label: string }[];

/** Nilai akhir tertinggi dulu; yang belum punya nilai akhir di bawah. */
export function sortSummaries(rows: readonly FeedbackSummary[]): FeedbackSummary[] {
  const key = (s: FeedbackSummary) => toScore(s.final_score) ?? toScore(s.overall_360_score) ?? -1;
  const hasFinal = (s: FeedbackSummary) => (toScore(s.final_score) === null ? 0 : 1);
  return [...rows].sort((a, b) => hasFinal(b) - hasFinal(a) || key(b) - key(a));
}

export function gradeVariant(grade: string | null): BadgeVariant {
  if (grade === "A") return "success";
  if (grade === "B") return "info";
  if (grade === "C") return "warning";
  if (grade === "D" || grade === "E") return "destructive";
  return "muted";
}

/** Rata-rata rating (1–5) satu penilaian, null bila belum ada jawaban. */
export function averageRating(responses: readonly Pick<FeedbackApprovalResponse, "rating">[]): number | null {
  if (responses.length === 0) return null;
  return responses.reduce((sum, r) => sum + r.rating, 0) / responses.length;
}

// ── Form penilai (ESS) ──

export const RATING_SCALE = [
  { value: 1, label: "Sangat kurang" },
  { value: 2, label: "Kurang" },
  { value: 3, label: "Cukup" },
  { value: 4, label: "Baik" },
  { value: 5, label: "Sangat baik" },
] as const;

export type AnswerMap = Record<string, { rating: number | null; comments: string }>;

export function answersFrom(responses: readonly MyFeedbackAnswer[]): AnswerMap {
  return Object.fromEntries(responses.map((r) => [r.criteria_id, { rating: r.rating, comments: r.comments ?? "" }]));
}

export function answerProgress(answers: AnswerMap, categories: readonly FeedbackCategory[]) {
  const ids = categories.flatMap((c) => c.criteria.map((cr) => cr.id));
  const answered = ids.filter((id) => answers[id]?.rating).length;
  return { answered, total: ids.length, complete: ids.length > 0 && answered === ids.length };
}

/** Body PUT /me/feedback-360/{id}: hanya kriteria yang sudah diberi rating. */
export function toSavePayload(answers: AnswerMap, submit: boolean): MyFeedbackSavePayload {
  const responses = Object.entries(answers)
    .filter(([, a]) => a.rating)
    .map(([criteria_id, a]) => ({ criteria_id, rating: a.rating as number, comments: a.comments.trim() || null }));
  return { responses, submit };
}
