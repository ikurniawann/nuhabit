import { ApiError } from "@/lib/api/auth";
import { queryOne } from "@/lib/db";
import { isUuid } from "./candidate-query";
import { enforceRateLimit, isLinkExpired, isPortalToken } from "./route-helpers";

/**
 * Helper bersama endpoint publik sesi psikotes (/api/psikotes/session/[token]).
 * Kandidat anonim: identitas = token sesi (>=32 byte, unik). Rate limit
 * di-key ke sesi supaya satu sesi tidak bisa membanjiri; token tak valid
 * ditolak murah lewat regex sebelum menyentuh DB.
 */

/** Grace penulisan jawaban setelah deadline tes (kompensasi latensi client). */
const ANSWER_GRACE_MS = 30_000;

/** Fallback masa hidup sesi bila expires_at NULL (jangan pernah abadi). */
const MAX_SESSION_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Limit per menit per sesi. Endpoint yang menulis disk jauh lebih ketat
 * daripada default 100/menit (temuan review: disk-fill DoS).
 */
const BUCKET_LIMITS: Record<string, number> = {
  upload: 6,
  proctor: 12,
};

export interface PsikotesSessionRow {
  id: string;
  candidate_id: string;
  token: string;
  status: "draft" | "sent" | "in_progress" | "completed" | "expired";
  webcam_consent: boolean | null;
  invited_at: string | null;
  expires_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  candidate_name: string;
  position_title: string | null;
}

export interface PsikotesSessionTestRow {
  id: string;
  session_id: string;
  instrument_id: string;
  status: "pending" | "in_progress" | "selesai" | "perlu_review" | "reviewed";
  answers: { question_ids?: string[]; answers?: Record<string, string> } | null;
  attachment_path: string | null;
  sort_order: number;
  started_at: string | null;
  completed_at: string | null;
  instrument_code: string;
  instrument_name: string;
  instrument_kind: "mcq" | "forced_choice" | "drawing";
  instrument_config: {
    duration_seconds?: number;
    question_count?: number | null;
    shuffle?: boolean;
    instructions?: string;
  };
}

/** 404 untuk token salah/tidak ada, 429 bila kuota `bucket` sesi habis. */
export async function requirePsikotesSession(token: string, bucket: string) {
  const session = await loadSessionByToken(token);
  if (!session) throw ApiError.notFound("Link tes tidak berlaku");
  enforceRateLimit(`psikotes_session_${bucket}_${session.id}`, BUCKET_LIMITS[bucket]);
  return session;
}

/**
 * Muat sesi via token + auto-expire bila lewat masa berlaku.
 * Return null utk token salah format / tidak ada.
 */
async function loadSessionByToken(token: string): Promise<PsikotesSessionRow | null> {
  if (!isPortalToken(token)) return null;
  const session = await queryOne<PsikotesSessionRow>(
    `SELECT s.id, s.candidate_id, s.token, s.status, s.webcam_consent,
            s.invited_at, s.expires_at, s.started_at, s.completed_at,
            c.full_name AS candidate_name, p.title AS position_title
     FROM recruitment.psikotes_sessions s
     JOIN recruitment.candidates c ON c.id = s.candidate_id
     LEFT JOIN hris.positions p ON p.id = c.position_id
     WHERE s.token = $1`,
    [token]
  );
  if (!session) return null;

  const isExpirable = session.status === "draft" || session.status === "sent" || session.status === "in_progress";
  if (isExpirable && isLinkExpired({ expires_at: session.expires_at, issued_at: session.invited_at }, MAX_SESSION_LIFETIME_MS)) {
    await queryOne(
      `UPDATE recruitment.psikotes_sessions SET status = 'expired' WHERE id = $1 RETURNING id`,
      [session.id]
    );
    return { ...session, status: "expired" };
  }
  return session;
}

/** Muat satu tes milik sesi (dgn metadata instrumen), atau null. */
export async function loadSessionTest(
  sessionId: string,
  testId: string
): Promise<PsikotesSessionTestRow | null> {
  if (!isUuid(testId)) return null;
  return queryOne<PsikotesSessionTestRow>(
    `SELECT t.id, t.session_id, t.instrument_id, t.status, t.answers,
            t.attachment_path, t.sort_order, t.started_at, t.completed_at,
            i.code AS instrument_code, i.name AS instrument_name,
            i.kind AS instrument_kind, i.config AS instrument_config
     FROM recruitment.psikotes_session_tests t
     JOIN recruitment.psikotes_instruments i ON i.id = t.instrument_id
     WHERE t.id = $1 AND t.session_id = $2`,
    [testId, sessionId]
  );
}

/** Tes milik sesi atau 404. */
export async function requireSessionTest(sessionId: string, testId: string) {
  const test = await loadSessionTest(sessionId, testId);
  if (!test) throw ApiError.notFound("Tes tidak ditemukan");
  return test;
}

/** Deadline tes = started_at + durasi instrumen (default 10 menit). */
export function testDeadlineMs(test: PsikotesSessionTestRow): number | null {
  if (!test.started_at) return null;
  const duration = (test.instrument_config.duration_seconds ?? 600) * 1000;
  return new Date(test.started_at).getTime() + duration;
}

/** True bila deadline + grace sudah lewat. */
export function isPastAnswerGrace(test: PsikotesSessionTestRow, now = Date.now()): boolean {
  const deadline = testDeadlineMs(test);
  return deadline !== null && now > deadline + ANSWER_GRACE_MS;
}

/** Bentuk tes yang aman dikirim ke kandidat (tanpa jawaban tersimpan). */
export function sanitizeTestForCandidate(test: PsikotesSessionTestRow) {
  return {
    id: test.id,
    status: test.status,
    sort_order: test.sort_order,
    started_at: test.started_at,
    completed_at: test.completed_at,
    has_attachment: Boolean(test.attachment_path),
    instrument: {
      code: test.instrument_code,
      name: test.instrument_name,
      kind: test.instrument_kind,
      duration_seconds: test.instrument_config.duration_seconds ?? 600,
      instructions: test.instrument_config.instructions ?? "",
    },
  };
}
