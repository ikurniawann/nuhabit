import type { PapiScaleCode } from "@/lib/recruitment/psikotes";

/** Bentuk data API panel aksi pipeline (applied → offer), dipakai klien & aturan tahap. */

export type StageRecommendation = "lolos" | "hold" | "tidak_lolos";

// ── Catatan internal HR (timeline) ─────────────────────────────────────

export interface CandidateNote {
  id: string;
  candidate_id: string;
  content: string;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
}

// ── Hasil screening call (1 baris per kandidat) ────────────────────────

export type ScreeningRecommendation = StageRecommendation;

export interface CandidateScreening {
  id: string;
  candidate_id: string;
  contacted: boolean;
  interested: boolean | null;
  availability_note: string | null;
  confirmed_salary: number | null;
  willing_shift: boolean | null;
  willing_placement: boolean | null;
  notes: string | null;
  recommendation: ScreeningRecommendation | null;
  updated_by: string | null;
  updated_by_name: string | null;
  created_at: string;
  updated_at: string;
}

export type ScreeningPayload = Omit<
  CandidateScreening,
  "id" | "candidate_id" | "updated_by" | "updated_by_name" | "created_at" | "updated_at"
>;

export type WaTemplateKey =
  | "undangan_screening"
  | "lolos_psikotes"
  | "undangan_psikotes"
  | "undangan_interview"
  | "lolos_interview"
  | "lolos_offer"
  | "offer_terkirim"
  | "penolakan";

// ── Psikotes (EPIC-002 TG4) ────────────────────────────────────────────

export type PsikotesRecommendation = StageRecommendation;

export interface PsikotesSummary {
  id: string;
  candidate_id: string;
  recommendation: PsikotesRecommendation | null;
  notes: string | null;
  updated_by_name: string | null;
  updated_at: string;
}

export type PsikotesSummaryPayload = Pick<PsikotesSummary, "recommendation" | "notes">;

/** Selaras McqScoreResult["detail"] di lib/recruitment/psikotes-scoring.ts. */
export interface McqScoreDetail {
  total: number;
  correct: number;
  per_question?: { id: string; given: string | null; correct_key: string; is_correct: boolean }[];
}

/** Insight AI tes gambar: indikatif utk HRD, bukan keputusan final. */
export interface DrawingAiInsightRecord {
  observation: string;
  /** "ai" = observasi otomatis dari OpenAI vision; "manual" = ditulis HRD.
   *  Undefined utk record lama (sebelum mode otomatis ada) = manual. */
  observation_source?: "manual" | "ai";
  vision_model?: string | null;
  insight: {
    ringkasan: string;
    indikasi: { aspek: string; insight: string }[];
    perhatikan_saat_interview: string[];
    keterbatasan: string;
  };
  model: string;
  created_at: string;
  created_by_name: string;
}

/** Selaras PapiScoreResult di lib/recruitment/psikotes-scoring.ts. */
export interface PapiScoreDetail {
  scales: Record<PapiScaleCode, number>;
  dominant: { code: PapiScaleCode; label: string; count: number }[];
  answered: number;
  total: number;
}

interface PsikotesSessionTestBase {
  id: string;
  session_id: string;
  status: "pending" | "in_progress" | "selesai" | "perlu_review" | "reviewed";
  score: number | null;
  attachment_path: string | null;
  review_notes: string | null;
  reviewed_by_name: string | null;
  sort_order: number;
  started_at: string | null;
  completed_at: string | null;
  instrument_code: string;
  instrument_name: string;
}

/** Discriminated union: bentuk score_detail terikat pada jenis instrumen. */
export type PsikotesSessionTest =
  | (PsikotesSessionTestBase & {
      instrument_kind: "mcq";
      score_detail: McqScoreDetail | null;
      ai_insight: null;
    })
  | (PsikotesSessionTestBase & {
      instrument_kind: "forced_choice";
      score_detail: PapiScoreDetail | null;
      ai_insight: null;
    })
  | (PsikotesSessionTestBase & {
      instrument_kind: "drawing";
      score_detail: null;
      ai_insight: DrawingAiInsightRecord | null;
    });

/** Rekap proctoring per sesi (psikotes & interview). */
export interface ProctorTally {
  flags: number;
  snapshots: number;
}

export interface PsikotesSession {
  id: string;
  /** null utk role read-only (hiring_manager): token = kredensial tes */
  token: string | null;
  status: "draft" | "sent" | "in_progress" | "completed" | "expired";
  webcam_consent: boolean | null;
  invited_at: string | null;
  expires_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_by_name: string | null;
  created_at: string;
  proctor: ProctorTally;
  tests: PsikotesSessionTest[];
}

export interface CandidatePsikotesData {
  summary: PsikotesSummary | null;
  sessions: PsikotesSession[];
}

export type ProctorMeta = Record<string, string | number | boolean> | null;

export interface PsikotesProctorEvent {
  id: string;
  event_type: "tab_blur" | "fullscreen_exit" | "paste" | "disconnect" | "webcam_snapshot";
  meta: ProctorMeta;
  storage_path: string | null;
  created_at: string;
}

/** Rincian soal + jawaban kandidat (HR-only, GET /session-tests/[id]/answers). */
export interface McqAnswerItem {
  id: string;
  /** null = soal sudah dihapus dari bank; skor tetap dari snapshot. */
  body: string | null;
  options: { key: string; text: string }[] | null;
  given: string | null;
  correct_key: string;
  is_correct: boolean;
}

export interface PapiAnswerItem {
  id: string;
  body: string | null;
  options: {
    a: { text: string; scale: PapiScaleCode };
    b: { text: string; scale: PapiScaleCode };
  } | null;
  given: "a" | "b" | null;
}

export type PsikotesTestAnswers =
  | { kind: "mcq"; items: McqAnswerItem[] }
  | { kind: "forced_choice"; items: PapiAnswerItem[] };

// ── Interview AI (EPIC-003) ─────────────────────────────────────────────

export interface InterviewRecording {
  path: string;
  size: number;
  modified_at: string;
}

export interface InterviewAiSummaryData {
  ringkasan: string;
  relevansi: {
    skor: number;
    kesimpulan: "relevan" | "cukup_relevan" | "kurang_relevan";
    alasan: string;
  };
  keahlian: string[];
  ekspektasi_gaji: { disebutkan: boolean; nilai: string | null; catatan: string };
  red_flags: string[];
  perhatikan_saat_interview_lanjutan: string[];
  keterbatasan: string;
}

export interface InterviewAiTurn {
  id: string;
  session_id: string;
  turn_no: number;
  topic: string | null;
  question: string;
  answer_transcript: string | null;
  answer_mode: "voice" | "text" | null;
  answer_audio_path: string | null;
  asked_at: string;
  answered_at: string | null;
}

export interface InterviewAiSession {
  id: string;
  /** null utk role read-only (hiring_manager): token = kredensial interview */
  token: string | null;
  status: "sent" | "in_progress" | "completed" | "expired";
  webcam_consent: boolean | null;
  config: { max_questions?: number } | null;
  ai_summary: InterviewAiSummaryData | null;
  summary_model: string | null;
  summarized_at: string | null;
  invited_at: string | null;
  expires_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_by_name: string | null;
  created_at: string;
  proctor: ProctorTally;
  turns: InterviewAiTurn[];
}

export interface CandidateInterviewData {
  sessions: InterviewAiSession[];
}

export interface InterviewProctorEvent {
  id: string;
  event_type:
    | "tab_blur"
    | "fullscreen_exit"
    | "paste"
    | "disconnect"
    | "webcam_snapshot"
    | "face_not_detected"
    | "multiple_faces"
    | "camera_off";
  meta: ProctorMeta;
  storage_path: string | null;
  created_at: string;
}

/** Undangan bertoken yang baru dibuat (psikotes & interview). */
export interface CreatedInvite {
  id: string;
  token: string;
  expires_at: string;
}

// ── Offer (EPIC-004) ────────────────────────────────────────────────────

export interface OfferSalaryReference {
  /** ekspektasi gaji dari form lamaran */
  expected_salary: number | null;
  /** ekspektasi yang diucapkan saat interview AI (ai_summary.ekspektasi_gaji) */
  interview_expectation: { disebutkan: boolean; nilai: string | null; catatan: string } | null;
  position_title: string | null;
  salary_min: number | null;
  salary_max: number | null;
}

export interface CandidateOffer {
  id: string;
  version: number;
  /** null utk role read-only (hiring_manager): token = kredensial portal */
  token: string | null;
  status: "sent" | "negotiating" | "accepted" | "declined" | "expired";
  position_title: string | null;
  base_salary: number;
  benefits: string[];
  start_date: string | null;
  notes: string | null;
  response_note: string | null;
  responded_at: string | null;
  response_source: "portal" | "manual" | null;
  sent_at: string | null;
  expires_at: string | null;
  created_by_name: string | null;
  created_at: string;
}

export interface CandidateOffersData {
  salary_reference: OfferSalaryReference;
  offers: CandidateOffer[];
}

export interface OfferCreatePayload {
  base_salary: number;
  benefits: string[];
  start_date?: string | null;
  notes?: string | null;
  expires_days: number;
}

export type OfferResponseStatus = "negotiating" | "accepted" | "declined";

// ── AI analysis CV (DeepSeek) ──────────────────────────────────────────

export interface CandidateAiAnalysis {
  id: string;
  candidate_id: string;
  extracted: {
    nama: string | null;
    email: string | null;
    no_hp: string | null;
    sumber: string | null;
    pendidikan: string | null;
    pengalaman: string | null;
    metode_ekstraksi?: string;
  };
  summary: string | null;
  match_score: number | null;
  match_reason: string | null;
  job_context: string | null;
  model: string | null;
  created_at: string;
  updated_at: string;
}
