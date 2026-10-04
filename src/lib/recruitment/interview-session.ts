import { ApiError } from "@/lib/api/auth";
import { queryOne, query } from "@/lib/db";
import { INTERVIEW_MAX_QUESTIONS_DEFAULT, INTERVIEW_MAX_QUESTIONS_LIMIT } from "./interview-ai";
import { enforceRateLimit, isLinkExpired, isPortalToken } from "./route-helpers";

/**
 * Helper bersama endpoint publik sesi interview AI
 * (/api/interview/session/[token]), pola sama dgn psikotes-session:
 * kandidat anonim, identitas = token sesi; rate limit di-key ke token.
 */

/** Fallback masa hidup sesi bila expires_at NULL (jangan pernah abadi). */
const MAX_SESSION_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000;

/** Limit per menit per sesi — endpoint penulis disk/LLM jauh lebih ketat. */
const BUCKET_LIMITS: Record<string, number> = {
  answer: 6,
  proctor: 12,
};

export interface InterviewSessionRow {
  id: string;
  candidate_id: string;
  token: string;
  status: "sent" | "in_progress" | "completed" | "expired";
  webcam_consent: boolean | null;
  config: { max_questions?: number } | null;
  ai_summary: unknown;
  invited_at: string | null;
  expires_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  candidate_name: string;
  position_title: string | null;
}

export interface InterviewTurnRow {
  id: string;
  session_id: string;
  turn_no: number;
  topic: string | null;
  question: string;
  question_audio_path: string | null;
  answer_audio_path: string | null;
  answer_transcript: string | null;
  answer_mode: "voice" | "text" | null;
  asked_at: string;
  answered_at: string | null;
}

/** 404 untuk token salah/tidak ada, 429 bila kuota `bucket` sesi habis. */
export async function requireInterviewSession(token: string, bucket: string) {
  const session = await loadInterviewSessionByToken(token);
  if (!session) throw ApiError.notFound("Link interview tidak berlaku");
  enforceRateLimit(`interview_session_${bucket}_${session.id}`, BUCKET_LIMITS[bucket]);
  return session;
}

/** Muat sesi via token + auto-expire bila lewat masa berlaku. */
async function loadInterviewSessionByToken(
  token: string
): Promise<InterviewSessionRow | null> {
  if (!isPortalToken(token)) return null;
  const session = await queryOne<InterviewSessionRow>(
    `SELECT s.id, s.candidate_id, s.token, s.status, s.webcam_consent, s.config,
            s.ai_summary, s.invited_at, s.expires_at, s.started_at, s.completed_at,
            c.full_name AS candidate_name, p.title AS position_title
     FROM recruitment.interview_ai_sessions s
     JOIN recruitment.candidates c ON c.id = s.candidate_id
     LEFT JOIN hris.positions p ON p.id = c.position_id
     WHERE s.token = $1`,
    [token]
  );
  if (!session) return null;

  const isExpirable = session.status === "sent" || session.status === "in_progress";
  if (isExpirable && isLinkExpired({ expires_at: session.expires_at, issued_at: session.invited_at }, MAX_SESSION_LIFETIME_MS)) {
    await queryOne(
      `UPDATE recruitment.interview_ai_sessions SET status = 'expired' WHERE id = $1 RETURNING id`,
      [session.id]
    );
    return { ...session, status: "expired" };
  }
  return session;
}

export const TURN_COLUMNS = `id, session_id, turn_no, topic, question, question_audio_path,
  answer_audio_path, answer_transcript, answer_mode, asked_at, answered_at`;

/** Semua turn satu sesi, urut nomor. */
export async function loadInterviewTurns(sessionId: string): Promise<InterviewTurnRow[]> {
  return query<InterviewTurnRow>(
    `SELECT ${TURN_COLUMNS} FROM recruitment.interview_ai_turns
     WHERE session_id = $1
     ORDER BY turn_no`,
    [sessionId]
  );
}

/** Turn aktif (belum dijawab) dengan nomor terkecil, atau null. */
export function loadActiveTurn(sessionId: string) {
  return queryOne<InterviewTurnRow>(
    `SELECT ${TURN_COLUMNS} FROM recruitment.interview_ai_turns
     WHERE session_id = $1 AND answered_at IS NULL
     ORDER BY turn_no LIMIT 1`,
    [sessionId]
  );
}

/** Batas jumlah pertanyaan sesi (dari config, di-clamp ke limit sistem). */
export function sessionMaxQuestions(session: InterviewSessionRow): number {
  const n = Number(session.config?.max_questions ?? INTERVIEW_MAX_QUESTIONS_DEFAULT);
  if (!Number.isFinite(n) || n < 3) return INTERVIEW_MAX_QUESTIONS_DEFAULT;
  return Math.min(INTERVIEW_MAX_QUESTIONS_LIMIT, Math.round(n));
}

/** Bentuk turn yang aman dikirim ke kandidat (tanpa path storage internal). */
export function sanitizeTurnForCandidate(turn: InterviewTurnRow) {
  return {
    id: turn.id,
    turn_no: turn.turn_no,
    question: turn.question,
    answer_transcript: turn.answer_transcript,
    answered_at: turn.answered_at,
    asked_at: turn.asked_at,
  };
}
