/**
 * Tiket keluhan pelanggan (EPIC-067 T-067-B1). Logika murni — query di
 * complaints-server.ts. Batas waktu per kategori mengikuti keputusan client
 * no. 7 (cedera 2 jam respons / 24 jam selesai; lainnya 24 jam / 3 hari);
 * pengaturannya menyusul di T-067-B2.
 */

import type { CsCategory, CsPriority } from "@/lib/crm/cs-rules";

export const COMPLAINT_CATEGORIES = ["coach", "class", "facility", "injury", "billing", "other"] as const;
export type ComplaintCategory = (typeof COMPLAINT_CATEGORIES)[number];

export const COMPLAINT_CATEGORY_LABEL: Record<ComplaintCategory, string> = {
  coach: "Coach",
  class: "Kelas",
  facility: "Fasilitas",
  injury: "Cedera",
  billing: "Billing",
  other: "Lainnya",
};

export const COMPLAINT_SOURCES = ["wa", "front_desk", "member_app"] as const;
export type ComplaintSource = (typeof COMPLAINT_SOURCES)[number];

export const COMPLAINT_SOURCE_LABEL: Record<ComplaintSource, string> = {
  wa: "WhatsApp",
  front_desk: "Front desk",
  member_app: "Member App",
};

export const COMPLAINT_STATUSES = ["received", "in_progress", "resolved", "confirmed", "cancelled"] as const;
export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];

export const COMPLAINT_STATUS_LABEL: Record<ComplaintStatus, string> = {
  received: "Diterima",
  in_progress: "Ditangani",
  resolved: "Selesai",
  confirmed: "Dikonfirmasi member",
  cancelled: "Dibatalkan",
};

export type ComplaintPriority = CsPriority;

/** Masih perlu ditangani (belum selesai / dibatalkan). */
export function isComplaintOpen(status: ComplaintStatus): boolean {
  return status === "received" || status === "in_progress";
}

export interface ComplaintSla {
  respond_hours: number;
  resolve_hours: number;
}

export type ComplaintSlaRules = Record<ComplaintCategory, ComplaintSla>;

export const DEFAULT_COMPLAINT_SLA: ComplaintSlaRules = {
  injury: { respond_hours: 2, resolve_hours: 24 },
  coach: { respond_hours: 24, resolve_hours: 72 },
  class: { respond_hours: 24, resolve_hours: 72 },
  facility: { respond_hours: 24, resolve_hours: 72 },
  billing: { respond_hours: 24, resolve_hours: 72 },
  other: { respond_hours: 24, resolve_hours: 72 },
};

export function complaintDeadlines(
  category: ComplaintCategory,
  createdAt: Date,
  rules: ComplaintSlaRules = DEFAULT_COMPLAINT_SLA
): { respondBy: Date; resolveBy: Date } {
  const sla = rules[category];
  return {
    respondBy: new Date(createdAt.getTime() + sla.respond_hours * 3_600_000),
    resolveBy: new Date(createdAt.getTime() + sla.resolve_hours * 3_600_000),
  };
}

/** Prioritas awal bila staf tidak memilih: cedera selalu tinggi. */
export function defaultComplaintPriority(category: ComplaintCategory): ComplaintPriority {
  return category === "injury" ? "high" : "normal";
}

/** Kategori WA inbox (EPIC-012) → kategori tiket. Yang tidak jelas jatuh ke "Lainnya" untuk dipilah staf. */
export function categoryFromCs(cs: CsCategory | null | undefined): ComplaintCategory {
  return cs === "pembayaran" ? "billing" : "other";
}

/** "KEL-2610-0007" — kode per bulan (WIB). */
export function complaintCode(now: Date, seq: number): string {
  const wib = new Date(now.getTime() + 7 * 3_600_000);
  const yymm = `${String(wib.getUTCFullYear()).slice(2)}${String(wib.getUTCMonth() + 1).padStart(2, "0")}`;
  return `KEL-${yymm}-${String(seq).padStart(4, "0")}`;
}

/** Judul otomatis dari deskripsi bila staf tidak mengisi judul. */
export function complaintTitle(title: string | null | undefined, description: string | null | undefined, category: ComplaintCategory): string {
  const t = (title ?? "").trim();
  if (t) return t.slice(0, 120);
  const d = (description ?? "").trim().replace(/\s+/g, " ");
  if (d) return d.length > 80 ? `${d.slice(0, 77)}…` : d;
  return `Keluhan ${COMPLAINT_CATEGORY_LABEL[category].toLowerCase()}`;
}

// ── Alur penyelesaian (T-067-B2) ───────────────────────────────────────────

/** Perpindahan status yang sah. Selesai bisa dibuka lagi bila member belum puas. */
const TRANSITIONS: Record<ComplaintStatus, ComplaintStatus[]> = {
  received: ["in_progress", "resolved", "cancelled"],
  in_progress: ["resolved", "cancelled"],
  resolved: ["confirmed", "in_progress"],
  confirmed: [],
  cancelled: [],
};

export function nextStatuses(from: ComplaintStatus): ComplaintStatus[] {
  return TRANSITIONS[from];
}

export function canTransition(from: ComplaintStatus, to: ComplaintStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Selesai wajib berisi catatan penyelesaian; batal & buka lagi wajib beralasan. */
export function transitionNeedsNote(from: ComplaintStatus, to: ComplaintStatus): boolean {
  return to === "resolved" || to === "cancelled" || (from === "resolved" && to === "in_progress");
}

export const COMPLAINT_ACTION_LABEL: Record<ComplaintStatus, string> = {
  received: "Diterima",
  in_progress: "Mulai tangani",
  resolved: "Tandai selesai",
  confirmed: "Dikonfirmasi member",
  cancelled: "Batalkan tiket",
};

/** Label tombol: "Buka lagi" untuk resolved → in_progress. */
export function actionLabel(from: ComplaintStatus, to: ComplaintStatus): string {
  return from === "resolved" && to === "in_progress" ? "Buka lagi" : COMPLAINT_ACTION_LABEL[to];
}

export type SlaState = "ok" | "respond_overdue" | "resolve_overdue";

/**
 * Status SLA saat ini: respons dianggap terpenuhi begitu tiket mulai ditangani
 * (first_response_at); penyelesaian terpenuhi saat selesai. Tiket tertutup = ok.
 */
export function complaintSlaState(
  t: { status: ComplaintStatus; respond_by: string | null; resolve_by: string | null; first_response_at: string | null },
  now: Date
): SlaState {
  if (!isComplaintOpen(t.status)) return "ok";
  if (t.resolve_by && new Date(t.resolve_by) < now) return "resolve_overdue";
  if (!t.first_response_at && t.respond_by && new Date(t.respond_by) < now) return "respond_overdue";
  return "ok";
}

export const MAX_SLA_HOURS = 24 * 14;

/** Gabungkan aturan tersimpan (sebagian / versi lama) dengan default per kategori. */
export function normalizeSlaRules(raw: unknown): ComplaintSlaRules {
  const stored = raw && typeof raw === "object" ? (raw as Record<string, Partial<ComplaintSla>>) : {};
  const out = {} as ComplaintSlaRules;
  const clamp = (v: unknown, fallback: number) => (Number.isInteger(v) ? Math.min(MAX_SLA_HOURS, Math.max(1, v as number)) : fallback);
  for (const c of COMPLAINT_CATEGORIES) {
    const base = DEFAULT_COMPLAINT_SLA[c];
    const s = stored[c] ?? {};
    const respond = clamp(s.respond_hours, base.respond_hours);
    out[c] = { respond_hours: respond, resolve_hours: Math.max(respond, clamp(s.resolve_hours, base.resolve_hours)) };
  }
  return out;
}

export interface ComplaintSettings {
  sla_rules: ComplaintSlaRules;
  /** PIC otomatis per kategori (user id) saat tiket dibuat. */
  default_assignees: Partial<Record<ComplaintCategory, string | null>>;
}

export const COMPLAINT_SETTING_KEYS: Record<keyof ComplaintSettings, string> = {
  sla_rules: "complaint_sla_rules",
  default_assignees: "complaint_default_assignees",
};

// ── Eskalasi (T-067-B3) ────────────────────────────────────────────────────

export type EscalationKind = "respond" | "resolve";

export interface EscalationCandidate {
  status: ComplaintStatus;
  respond_by: string | null;
  resolve_by: string | null;
  first_response_at: string | null;
  respond_escalated_at: string | null;
  resolve_escalated_at: string | null;
}

/** Eskalasi yang jatuh tempo dan belum pernah dikirim (masing-masing sekali per tiket). */
export function dueEscalations(t: EscalationCandidate, now: Date): EscalationKind[] {
  if (!isComplaintOpen(t.status)) return [];
  const out: EscalationKind[] = [];
  if (!t.first_response_at && !t.respond_escalated_at && t.respond_by && new Date(t.respond_by) < now) out.push("respond");
  if (!t.resolve_escalated_at && t.resolve_by && new Date(t.resolve_by) < now) out.push("resolve");
  return out;
}

/**
 * Eskalasi ke staf boleh dikirim di luar 08.00–21.00 WIB hanya untuk tiket
 * cedera atau prioritas tinggi/mendesak; sisanya menunggu pagi.
 */
export function escalationSendableNow(now: Date, t: { category: ComplaintCategory; priority: ComplaintPriority }): boolean {
  const hour = new Date(now.getTime() + 7 * 3_600_000).getUTCHours();
  if (hour >= 8 && hour < 21) return true;
  return t.category === "injury" || t.priority === "high" || t.priority === "urgent";
}

const PRIORITY_ID: Record<ComplaintPriority, string> = { low: "Rendah", normal: "Normal", high: "Tinggi", urgent: "Mendesak" };

export function complaintEscalationMessage(input: {
  kind: EscalationKind;
  code: string;
  title: string;
  category: ComplaintCategory;
  priority: ComplaintPriority;
  reporter: string | null;
  coach: string | null;
  assignee: string | null;
  deadline: string;
  url: string;
}): string {
  const deadline = new Date(input.deadline).toLocaleString("id-ID", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  });
  return [
    input.kind === "respond" ? `⚠️ *Keluhan belum ditangani* (batas respons ${deadline})` : `⚠️ *Keluhan belum selesai* (batas selesai ${deadline})`,
    ``,
    `${input.code} · ${COMPLAINT_CATEGORY_LABEL[input.category]} · ${PRIORITY_ID[input.priority]}`,
    input.title,
    input.reporter ? `Pelapor: ${input.reporter}` : null,
    input.coach ? `Coach: ${input.coach}` : null,
    `PIC: ${input.assignee ?? "belum ada"}`,
    ``,
    `Tangani di: ${input.url}`,
  ]
    .filter((l): l is string => l !== null)
    .join("\n");
}
