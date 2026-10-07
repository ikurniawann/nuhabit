import type { Candidate, Brand } from "@/types";
import { fetchActiveBrands, fetchAllCandidates } from "../candidates/api";
import type {
  CandidateAiAnalysis,
  CandidateInterviewData,
  CandidateNote,
  CandidateOffersData,
  CandidatePsikotesData,
  CandidateScreening,
  CreatedInvite,
  DrawingAiInsightRecord,
  InterviewProctorEvent,
  InterviewRecording,
  OfferCreatePayload,
  OfferResponseStatus,
  PipelineStage,
  PsikotesProctorEvent,
  PsikotesSummary,
  PsikotesSummaryPayload,
  PsikotesTestAnswers,
  ScreeningPayload,
  WaTemplateKey,
} from "./types";

export const fetchPipelineCandidates = (): Promise<Candidate[]> =>
  fetchAllCandidates({ sort: "updated_at" });

export const fetchPipelineBrands = (): Promise<Brand[]> => fetchActiveBrands();

/**
 * fetch JSON → `data`. Pesan error dari server (`json.error`) diteruskan;
 * `fallback` hanya dipakai bila server tidak mengirim pesan.
 */
async function request<T>(
  url: string,
  fallback: string,
  init?: { method: "POST" | "PUT"; body?: unknown }
): Promise<T> {
  const res = await fetch(
    url,
    init && {
      method: init.method,
      headers: { "Content-Type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }
  );
  const json: { data?: T; error?: string } = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? fallback);
  return json.data as T;
}

const post = <T>(url: string, body: unknown, fallback: string) =>
  request<T>(url, fallback, { method: "POST", body });
const put = <T>(url: string, body: unknown, fallback: string) =>
  request<T>(url, fallback, { method: "PUT", body });

// via endpoint khusus supaya perpindahan selalu tercatat di activity log
export const updateCandidateStage = (id: string, status: PipelineStage) =>
  post<unknown>(`/api/candidates/${id}/stage`, { status }, "Gagal memindahkan kandidat");

// ── Catatan internal HR ────────────────────────────────────────────────

export const fetchCandidateNotes = async (candidateId: string) =>
  (await request<CandidateNote[] | null>(`/api/candidates/${candidateId}/notes`, "Gagal memuat catatan")) ?? [];

export const addCandidateNote = (candidateId: string, content: string) =>
  post<CandidateNote>(`/api/candidates/${candidateId}/notes`, { content }, "Gagal menyimpan catatan");

// ── Screening ──────────────────────────────────────────────────────────

export const fetchCandidateScreening = (candidateId: string) =>
  request<CandidateScreening | null>(
    `/api/candidates/${candidateId}/screening`,
    "Gagal memuat hasil screening"
  );

export const saveCandidateScreening = (candidateId: string, payload: ScreeningPayload) =>
  put<CandidateScreening>(
    `/api/candidates/${candidateId}/screening`,
    payload,
    "Gagal menyimpan hasil screening"
  );

export const logWaTemplateActivity = (candidateId: string, template: WaTemplateKey) =>
  post<unknown>(`/api/candidates/${candidateId}/activities`, { template }, "Gagal mencatat aktivitas");

// ── Psikotes ───────────────────────────────────────────────────────────

export const fetchCandidatePsikotes = (candidateId: string) =>
  request<CandidatePsikotesData>(`/api/candidates/${candidateId}/psikotes`, "Gagal memuat data psikotes");

export const createPsikotesSession = (
  candidateId: string,
  payload: { instrument_ids: string[]; expires_days: number }
) =>
  post<CreatedInvite>(
    `/api/candidates/${candidateId}/psikotes/sessions`,
    payload,
    "Gagal membuat undangan tes"
  );

export const savePsikotesSummary = (candidateId: string, payload: PsikotesSummaryPayload) =>
  put<PsikotesSummary>(
    `/api/candidates/${candidateId}/psikotes/summary`,
    payload,
    "Gagal menyimpan rekomendasi"
  );

export const fetchPsikotesProctorEvents = async (sessionId: string) =>
  (await request<PsikotesProctorEvent[] | null>(
    `/api/psikotes/sessions/${sessionId}/proctor-events`,
    "Gagal memuat arsip proctoring"
  )) ?? [];

export const fetchPsikotesTestAnswers = (testId: string) =>
  request<PsikotesTestAnswers>(
    `/api/psikotes/session-tests/${testId}/answers`,
    "Gagal memuat rincian jawaban"
  );

/** observation kosong/undefined = mode otomatis (AI membaca gambarnya). */
export const requestPsikotesAiInsight = (testId: string, observation?: string) =>
  post<DrawingAiInsightRecord>(
    `/api/psikotes/session-tests/${testId}/ai-insight`,
    { observation: observation ?? "" },
    "Gagal membuat insight AI"
  );

export const reviewPsikotesTest = (testId: string, reviewNotes: string) =>
  put<unknown>(
    `/api/psikotes/session-tests/${testId}/review`,
    { review_notes: reviewNotes },
    "Gagal menyimpan review"
  );

// ── Interview AI ───────────────────────────────────────────────────────

export const fetchCandidateInterview = (candidateId: string) =>
  request<CandidateInterviewData>(`/api/candidates/${candidateId}/interview`, "Gagal memuat data interview");

export const createInterviewSession = (
  candidateId: string,
  payload: { expires_days: number; max_questions: number }
) =>
  post<CreatedInvite>(
    `/api/candidates/${candidateId}/interview/sessions`,
    payload,
    "Gagal membuat undangan interview"
  );

export const fetchInterviewProctorEvents = async (sessionId: string) =>
  (await request<InterviewProctorEvent[] | null>(
    `/api/interview/sessions/${sessionId}/proctor-events`,
    "Gagal memuat arsip proctoring"
  )) ?? [];

export const fetchInterviewRecordings = async (sessionId: string) =>
  (await request<InterviewRecording[] | null>(
    `/api/interview/sessions/${sessionId}/recordings`,
    "Gagal memuat rekaman"
  )) ?? [];

// ── Offer ──────────────────────────────────────────────────────────────

export const fetchCandidateOffers = (candidateId: string) =>
  request<CandidateOffersData>(`/api/candidates/${candidateId}/offers`, "Gagal memuat data offer");

export const createCandidateOffer = (candidateId: string, payload: OfferCreatePayload) =>
  post<CreatedInvite & { version: number }>(
    `/api/candidates/${candidateId}/offers`,
    payload,
    "Gagal membuat offer"
  );

export const recordOfferResponse = (
  offerId: string,
  payload: { status: OfferResponseStatus; note?: string | null }
) => put<unknown>(`/api/offers/${offerId}/response`, payload, "Gagal mencatat respons");

// ── AI analysis CV ─────────────────────────────────────────────────────

export const fetchCandidateAiAnalysis = (candidateId: string) =>
  request<CandidateAiAnalysis | null>(`/api/candidates/${candidateId}/ai-analysis`, "Gagal memuat analisis");

export const runCandidateAiAnalysis = (candidateId: string) =>
  request<CandidateAiAnalysis>(`/api/candidates/${candidateId}/ai-analysis`, "Analisis gagal", {
    method: "POST",
  });
