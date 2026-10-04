import { ApiError } from "@/lib/api/auth";
import { queryOne, withTransaction } from "@/lib/db";
import {
  appendPrivateChunk,
  listPrivateFiles,
  readPrivateFile,
  savePrivateAudio,
  sniffAudioMime,
} from "@/lib/storage-private";
import { interviewStartSchema } from "@/lib/validations/interview";
import { isUuid } from "./candidate-query";
import { parseBody } from "./candidates-repo";
import {
  generateNextInterviewQuestion,
  summarizeInterview,
  synthesizeInterviewSpeech,
  transcribeInterviewAudio,
  type InterviewTurnForAi,
} from "./interview-ai";
import {
  loadActiveTurn,
  loadInterviewTurns,
  sanitizeTurnForCandidate,
  sessionMaxQuestions,
  TURN_COLUMNS,
  type InterviewSessionRow,
  type InterviewTurnRow,
} from "./interview-session";

/**
 * Alur kandidat di portal interview AI: mulai → jawab (suara/ketik) →
 * pertanyaan berikutnya atau penutupan + kesimpulan AI. Route token
 * memanggil fungsi di sini setelah token & rate limit lolos.
 */

export const MAX_AUDIO_BYTES = 15 * 1024 * 1024;
const MAX_TEXT_CHARS = 4000;
export const MAX_CHUNK_BYTES = 8 * 1024 * 1024;
/** Kuota per part rekaman (~2 jam pada ~500 kbps). */
const MAX_PART_BYTES = 400 * 1024 * 1024;
const PART_RE = /^[0-9]{10,16}$/;

const INVALID_PAYLOAD = "Payload tidak valid";

export async function getInterviewPortalData(session: InterviewSessionRow) {
  const turns = await loadInterviewTurns(session.id);
  const current = turns.find((t) => !t.answered_at) ?? null;

  let currentAudioBase64: string | null = null;
  if (current?.question_audio_path) {
    const { data } = await readPrivateFile(current.question_audio_path);
    if (data) currentAudioBase64 = data.toString("base64");
  }

  return {
    session: {
      status: session.status,
      candidate_name: session.candidate_name,
      position_title: session.position_title,
      webcam_consent: session.webcam_consent,
      max_questions: sessionMaxQuestions(session),
      expires_at: session.expires_at,
      started_at: session.started_at,
      completed_at: session.completed_at,
    },
    turns: turns.map(sanitizeTurnForCandidate),
    current_turn: current
      ? { ...sanitizeTurnForCandidate(current), question_audio_base64: currentAudioBase64 }
      : null,
  };
}

/** Audio TTS pertanyaan, best-effort: interview tetap jalan (teks) bila TTS gagal. */
async function speakQuestion(sessionId: string, question: string) {
  const buffer = await synthesizeInterviewSpeech(question);
  if (!buffer) return { buffer: null, path: null };
  const saved = await savePrivateAudio(buffer, `interview/${sessionId}/questions`);
  return { buffer, path: saved.path };
}

function turnWithAudio(turn: InterviewTurnRow, audio: Buffer | null) {
  return { ...sanitizeTurnForCandidate(turn), question_audio_base64: audio ? audio.toString("base64") : null };
}

/**
 * Mulai interview: consent kamera WAJIB, pertanyaan pertama (+TTS), sesi
 * in_progress. Idempoten: sesi berjalan mengembalikan pertanyaan aktif.
 */
export async function startInterview(session: InterviewSessionRow, request: Request) {
  if (session.status === "completed" || session.status === "expired") {
    throw ApiError.conflict("Sesi interview sudah berakhir");
  }
  if (session.status === "in_progress") {
    const current = await loadActiveTurn(session.id);
    return { turn: current ? sanitizeTurnForCandidate(current) : null };
  }

  await parseBody(request, interviewStartSchema);
  const first = await generateNextInterviewQuestion({
    candidateName: session.candidate_name,
    positionTitle: session.position_title,
    turns: [],
    maxQuestions: sessionMaxQuestions(session),
  });
  if (first.action !== "ask" || !first.question) {
    throw ApiError.server("Gagal menyiapkan pertanyaan pertama");
  }
  const question = first.question;
  const audio = await speakQuestion(session.id, question);

  const turn = await withTransaction(async (client) => {
    await client.query(
      `UPDATE recruitment.interview_ai_sessions
       SET status = 'in_progress', webcam_consent = true, started_at = now()
       WHERE id = $1 AND status = 'sent'`,
      [session.id]
    );
    const res = await client.query<InterviewTurnRow>(
      `INSERT INTO recruitment.interview_ai_turns
         (session_id, turn_no, topic, question, question_audio_path)
       VALUES ($1, 1, $2, $3, $4)
       ON CONFLICT (session_id, turn_no) DO UPDATE SET turn_no = EXCLUDED.turn_no
       RETURNING ${TURN_COLUMNS}`,
      [session.id, first.topic, question, audio.path]
    );
    return res.rows[0];
  });
  return { turn: turnWithAudio(turn, audio.buffer) };
}

/** Transkrip dulu: bila Whisper gagal tidak ada yang tersimpan, kandidat bisa kirim ulang. */
async function readVoiceAnswer(sessionId: string, audio: FormDataEntryValue | null) {
  if (!(audio instanceof File) || audio.size === 0) throw ApiError.badRequest("Rekaman suara kosong");
  if (audio.size > MAX_AUDIO_BYTES) throw new ApiError(413, "Rekaman terlalu besar (maks 15 MB)");
  const buffer = Buffer.from(await audio.arrayBuffer());
  const sniffed = sniffAudioMime(buffer);
  if (!sniffed) throw ApiError.badRequest("Format audio tidak dikenali");
  let result: { transcript: string; model: string };
  try {
    result = await transcribeInterviewAudio(buffer, sniffed);
  } catch (e) {
    console.error("[interview-answer] transcribe failed:", e);
    throw new ApiError(502, "Gagal mentranskrip suara — coba kirim ulang, atau ketik jawaban Anda");
  }
  const saved = await savePrivateAudio(buffer, `interview/${sessionId}/answers`);
  return { transcript: result.transcript, model: result.model, audioPath: saved.path };
}

/** Tutup sesi + kesimpulan AI best-effort (kegagalan AI tidak boleh menggantung sesi). */
async function closeInterview(session: InterviewSessionRow, turns: InterviewTurnForAi[]) {
  let summary: unknown = null;
  let summaryModel: string | null = null;
  try {
    const s = await summarizeInterview({
      candidateName: session.candidate_name,
      positionTitle: session.position_title,
      turns,
    });
    summary = s.result;
    summaryModel = s.model;
  } catch (e) {
    console.error("[interview-answer] summarize failed:", e);
  }

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE recruitment.interview_ai_sessions
       SET status = 'completed', completed_at = now(),
           ai_summary = $2, summary_model = $3,
           summarized_at = CASE WHEN $2::jsonb IS NULL THEN NULL ELSE now() END
       WHERE id = $1`,
      [session.id, summary ? JSON.stringify(summary) : null, summaryModel]
    );
    await client.query(
      `INSERT INTO recruitment.candidate_activities (candidate_id, activity_type, description)
       VALUES ($1, 'interview_ai_completed', $2)`,
      [
        session.candidate_id,
        `Interview AI selesai (${turns.length} pertanyaan)${summary ? " — kesimpulan AI tersedia" : ""}`,
      ]
    );
  });
}

/**
 * Jawaban kandidat (multipart: turn_id, mode voice|text, audio | answer_text).
 * Setelah tersimpan AI menentukan pertanyaan berikutnya (+TTS) atau menutup sesi.
 */
export async function answerInterview(session: InterviewSessionRow, request: Request) {
  const form = await request.formData().catch(() => null);
  if (!form) throw ApiError.badRequest(INVALID_PAYLOAD);
  const turnId = String(form.get("turn_id") ?? "");
  const mode = String(form.get("mode") ?? "");
  if (!isUuid(turnId) || (mode !== "voice" && mode !== "text")) throw ApiError.badRequest(INVALID_PAYLOAD);

  const turn = await queryOne<InterviewTurnRow>(
    `SELECT ${TURN_COLUMNS} FROM recruitment.interview_ai_turns WHERE id = $1 AND session_id = $2`,
    [turnId, session.id]
  );
  if (!turn) throw ApiError.notFound("Pertanyaan tidak ditemukan");
  if (turn.answered_at) throw ApiError.conflict("Pertanyaan ini sudah dijawab");

  let transcript: string;
  let audioPath: string | null = null;
  let transcribeModel: string | null = null;
  if (mode === "voice") {
    const voice = await readVoiceAnswer(session.id, form.get("audio"));
    ({ transcript, audioPath } = voice);
    transcribeModel = voice.model;
  } else {
    transcript = String(form.get("answer_text") ?? "").trim().slice(0, MAX_TEXT_CHARS);
    if (!transcript) throw ApiError.badRequest("Jawaban kosong");
  }

  const updated = await queryOne<InterviewTurnRow>(
    `UPDATE recruitment.interview_ai_turns
     SET answer_transcript = $3, answer_audio_path = $4, answer_mode = $5,
         transcribe_model = $6, answered_at = now()
     WHERE id = $1 AND session_id = $2 AND answered_at IS NULL
     RETURNING ${TURN_COLUMNS}`,
    [turnId, session.id, transcript || null, audioPath, mode, transcribeModel]
  );
  if (!updated) throw ApiError.conflict("Pertanyaan ini sudah dijawab");

  const turnsForAi: InterviewTurnForAi[] = (await loadInterviewTurns(session.id)).map((t) => ({
    turn_no: t.turn_no,
    topic: t.topic,
    question: t.question,
    answer_transcript: t.answer_transcript,
  }));
  const next = await generateNextInterviewQuestion({
    candidateName: session.candidate_name,
    positionTitle: session.position_title,
    turns: turnsForAi,
    maxQuestions: sessionMaxQuestions(session),
  });
  if (next.action === "finish" || !next.question) {
    await closeInterview(session, turnsForAi);
    return { done: true };
  }

  const audio = await speakQuestion(session.id, next.question);
  const nextTurn = await queryOne<InterviewTurnRow>(
    `INSERT INTO recruitment.interview_ai_turns
       (session_id, turn_no, topic, question, question_audio_path)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (session_id, turn_no) DO NOTHING
     RETURNING ${TURN_COLUMNS}`,
    [session.id, updated.turn_no + 1, next.topic, next.question, audio.path]
  );
  if (nextTurn) return { done: false, turn: turnWithAudio(nextTurn, audio.buffer) };

  // balapan dgn request paralel: kembalikan turn aktif yang sudah dibuat
  const existing = await loadActiveTurn(session.id);
  return { done: false, turn: existing ? turnWithAudio(existing, null) : null };
}

/**
 * Potongan rekaman video (webm, timeslice 10 dtk) di-append ke file part
 * per sesi rekam; reload halaman memulai part baru supaya header webm valid.
 */
export async function appendRecordingChunk(session: InterviewSessionRow, request: Request) {
  const form = await request.formData().catch(() => null);
  if (!form) throw ApiError.badRequest(INVALID_PAYLOAD);
  const part = String(form.get("part") ?? "");
  const chunk = form.get("chunk");
  if (!PART_RE.test(part) || !(chunk instanceof File) || chunk.size === 0) {
    throw ApiError.badRequest(INVALID_PAYLOAD);
  }
  if (chunk.size > MAX_CHUNK_BYTES) throw new ApiError(413, "Chunk terlalu besar");

  const buffer = Buffer.from(await chunk.arrayBuffer());
  const saved = await appendPrivateChunk(
    `interview/${session.id}/recording/part-${part}.webm`,
    buffer,
    MAX_PART_BYTES
  );
  if (saved.error) throw new ApiError(saved.error.includes("Kuota") ? 429 : 400, saved.error);
  return { ok: true, size: saved.size };
}

/** Daftar rekaman video satu sesi utk HR; 404 bila sesi tidak ada. */
export async function listInterviewRecordings(sessionId: string) {
  const session = await queryOne<{ id: string }>(
    "SELECT id FROM recruitment.interview_ai_sessions WHERE id = $1",
    [sessionId]
  );
  if (!session) throw ApiError.notFound("Sesi tidak ditemukan");
  const files = await listPrivateFiles(`interview/${sessionId}/recording`);
  return files.map((f) => ({
    path: `interview/${sessionId}/recording/${f.name}`,
    size: f.size,
    modified_at: f.modified_at,
  }));
}
