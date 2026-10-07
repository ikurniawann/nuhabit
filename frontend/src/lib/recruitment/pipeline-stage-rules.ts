import type {
  CandidateOffer,
  CandidateScreening,
  InterviewAiSession,
  OfferCreatePayload,
  ProctorTally,
  PsikotesSession,
  PsikotesSessionTest,
  ScreeningPayload,
} from "./pipeline-types";

/** Aturan tahap pipeline: checklist otomatis, gate keputusan, validasi undangan. */

export interface ChecklistEntry {
  label: string;
  done: boolean;
  hint?: string;
}

export const countDone = (items: ChecklistEntry[]) => items.filter((c) => c.done).length;

const plural = (n: number, unit: string) => (n > 0 ? `${n} ${unit}` : undefined);

function proctorTotals(sessions: { proctor: ProctorTally }[]): ProctorTally {
  return sessions.reduce(
    (acc, s) => ({ flags: acc.flags + s.proctor.flags, snapshots: acc.snapshots + s.proctor.snapshots }),
    { flags: 0, snapshots: 0 }
  );
}

const proctorHint = ({ flags, snapshots }: ProctorTally) =>
  flags + snapshots > 0 ? `${flags} flag · ${snapshots} snapshot` : undefined;

// ── Applied ────────────────────────────────────────────────────────────

export function appliedChecklist(input: {
  cvUrl?: string | null;
  email?: string | null;
  phone?: string | null;
  hasAnalysis: boolean;
  noteCount: number;
}): ChecklistEntry[] {
  return [
    { label: "Lampiran CV", done: Boolean(input.cvUrl) },
    { label: "Analisis CV oleh AI vs Job Description", done: input.hasAnalysis },
    {
      label: "Kontak Kandidat (Email & HP)",
      done: Boolean(input.email?.trim()) && Boolean(input.phone?.trim()),
    },
    { label: "Catatan Internal HR", done: input.noteCount > 0 },
  ];
}

/** Jenis preview CV dari ekstensi URL. */
export function cvPreviewKind(url: string | null | undefined): "none" | "pdf" | "image" | "other" {
  if (!url) return "none";
  if (url.toLowerCase().endsWith(".pdf")) return "pdf";
  if (/\.(jpe?g|png)$/i.test(url)) return "image";
  return "other";
}

// ── Screening ──────────────────────────────────────────────────────────

export const EMPTY_SCREENING_DRAFT: ScreeningPayload = {
  contacted: false,
  interested: null,
  availability_note: null,
  confirmed_salary: null,
  willing_shift: null,
  willing_placement: null,
  notes: null,
  recommendation: null,
};

/** Selisih gaji yang memicu peringatan (20%). */
export const SALARY_GAP_THRESHOLD = 0.2;
// selaras dgn screeningSchema (max 1e12): 12 digit = 999.999.999.999
const SALARY_MAX_DIGITS = 12;

export function screeningDraftFrom(saved: CandidateScreening | null): ScreeningPayload {
  if (!saved) return EMPTY_SCREENING_DRAFT;
  return {
    contacted: saved.contacted,
    interested: saved.interested,
    availability_note: saved.availability_note,
    confirmed_salary: saved.confirmed_salary,
    willing_shift: saved.willing_shift,
    willing_placement: saved.willing_placement,
    notes: saved.notes,
    recommendation: saved.recommendation,
  };
}

/** Rapikan teks bebas (trim, kosong → null) sebelum dibandingkan/disimpan. */
export function normalizeScreeningDraft(draft: ScreeningPayload): ScreeningPayload {
  return {
    ...draft,
    availability_note: draft.availability_note?.trim() || null,
    notes: draft.notes?.trim() || null,
  };
}

export function isScreeningDirty(draft: ScreeningPayload, saved: ScreeningPayload): boolean {
  return JSON.stringify(normalizeScreeningDraft(draft)) !== JSON.stringify(saved);
}

/** Input gaji bebas → angka (hanya digit, maks 12 digit); kosong → null. */
export function parseSalaryInput(raw: string): number | null {
  const digits = raw.replace(/\D/g, "").slice(0, SALARY_MAX_DIGITS);
  return digits ? Number(digits) : null;
}

/** Rasio selisih gaji terkonfirmasi vs ekspektasi; null bila tak bisa dihitung. */
export function salaryGap(expected: number | null | undefined, confirmed: number | null): number | null {
  if (!expected || expected <= 0 || confirmed == null) return null;
  return (confirmed - expected) / expected;
}

export function screeningChecklist(draft: ScreeningPayload): ChecklistEntry[] {
  return [
    { label: "Kandidat dihubungi (screening call)", done: draft.contacted },
    {
      label: "Minat & ketersediaan dikonfirmasi",
      done: draft.interested !== null && Boolean(draft.availability_note?.trim()),
    },
    { label: "Gaji dikonfirmasi", done: draft.confirmed_salary != null },
    {
      label: "Kesediaan shift & penempatan",
      done: draft.willing_shift !== null && draft.willing_placement !== null,
    },
    { label: "Rekomendasi terisi", done: draft.recommendation !== null },
  ];
}

// ── Psikotes ───────────────────────────────────────────────────────────

/** Status tes yang dianggap tuntas dari sisi kandidat. */
export const PSIKOTES_TERMINAL_STATUSES: PsikotesSessionTest["status"][] = [
  "selesai",
  "perlu_review",
  "reviewed",
];

export const isPsikotesTestDone = (test: Pick<PsikotesSessionTest, "status">) =>
  PSIKOTES_TERMINAL_STATUSES.includes(test.status);

export function psikotesChecklist(
  sessions: PsikotesSession[],
  recommendationSaved: boolean
): ChecklistEntry[] {
  const tests = sessions.flatMap((s) => s.tests);
  const done = tests.filter(isPsikotesTestDone).length;
  const proctor = proctorTotals(sessions);
  return [
    { label: "Undangan tes dikirim", done: sessions.length > 0, hint: plural(sessions.length, "undangan") },
    {
      label: "Tes selesai & hasil tersedia",
      done: tests.length > 0 && done === tests.length,
      hint: tests.length > 0 ? `${done}/${tests.length} tes` : undefined,
    },
    { label: "Arsip bukti proctoring", done: proctor.flags + proctor.snapshots > 0, hint: proctorHint(proctor) },
    { label: "Rekomendasi HR terisi", done: recommendationSaved },
  ];
}

// ── Interview ──────────────────────────────────────────────────────────

export function interviewChecklist(sessions: InterviewAiSession[]): ChecklistEntry[] {
  const completed = sessions.filter((s) => s.status === "completed");
  const proctor = proctorTotals(sessions);
  return [
    {
      label: "Undangan interview dikirim",
      done: sessions.length > 0,
      hint: plural(sessions.length, "undangan"),
    },
    { label: "Interview selesai", done: completed.length > 0, hint: plural(completed.length, "sesi selesai") },
    { label: "Kesimpulan AI tersedia", done: completed.some((s) => s.ai_summary) },
    {
      label: "Analitik proctoring terekam",
      done: proctor.flags + proctor.snapshots > 0,
      hint: proctorHint(proctor),
    },
  ];
}

// ── Offer ──────────────────────────────────────────────────────────────

export const isOfferOpen = (offer: Pick<CandidateOffer, "status">) =>
  offer.status === "sent" || offer.status === "negotiating";

export function offerChecklist(offers: CandidateOffer[]): ChecklistEntry[] {
  return [
    { label: "Offer dibuat & dikirim", done: offers.length > 0, hint: plural(offers.length, "versi") },
    { label: "Respons kandidat tercatat", done: offers.some((o) => o.responded_at) },
    { label: "Offer diterima kandidat", done: offers.some((o) => o.status === "accepted") },
  ];
}

// ── Validasi form undangan ─────────────────────────────────────────────

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

function intInRange(raw: string, min: number, max: number, error: string): Parsed<number> {
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? { ok: true, value: n } : { ok: false, error };
}

export const parseExpiresDays = (raw: string) => intInRange(raw, 1, 30, "Masa berlaku harus 1–30 hari");

export const parseMaxQuestions = (raw: string) => intInRange(raw, 3, 15, "Jumlah pertanyaan harus 3–15");

/** Angka gaji dari input offer (abaikan non-digit). */
export const offerSalaryNumber = (raw: string) => Number(raw.replace(/[^\d]/g, ""));

const MAX_BENEFITS = 15;

export function parseOfferForm(form: {
  salary: string;
  benefitsText: string;
  startDate: string;
  notes: string;
  expiresDays: string;
}): Parsed<OfferCreatePayload> {
  const salary = offerSalaryNumber(form.salary);
  if (!Number.isFinite(salary) || salary <= 0) return { ok: false, error: "Isi gaji pokok yang valid" };
  const days = parseExpiresDays(form.expiresDays);
  if (!days.ok) return days;
  return {
    ok: true,
    value: {
      base_salary: salary,
      benefits: form.benefitsText
        .split("\n")
        .map((b) => b.trim())
        .filter(Boolean)
        .slice(0, MAX_BENEFITS),
      start_date: form.startDate || null,
      notes: form.notes.trim() || null,
      expires_days: days.value,
    },
  };
}
