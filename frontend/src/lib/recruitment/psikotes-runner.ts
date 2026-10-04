import { ApiError } from "@/lib/api/auth";
import { query, queryOne, withTransaction } from "@/lib/db";
import { deletePrivateFile, isAllowedImageMime, savePrivateImage, sniffImageMime } from "@/lib/storage-private";
import { sessionAnswersSchema, sessionStartSchema } from "@/lib/validations/psikotes";
import { scoreMcq, scorePapi } from "./psikotes-scoring";
import { parseJsonBody } from "./route-helpers";
import {
  isPastAnswerGrace,
  loadSessionTest,
  sanitizeTestForCandidate,
  testDeadlineMs,
  type PsikotesSessionRow,
  type PsikotesSessionTestRow,
} from "./psikotes-session";

/**
 * Alur kandidat di portal psikotes (sesi → tes → jawaban → skor).
 * Route token memanggil fungsi di sini setelah token & rate limit lolos.
 */

const TERMINAL_TEST_STATUSES = new Set(["selesai", "perlu_review", "reviewed"]);
export const MAX_DRAWING_BYTES = 8 * 1024 * 1024;

interface QuestionRow {
  id: string;
  body: string;
  options: unknown;
}

interface QuestionScoringRow {
  id: string;
  options: unknown;
  answer_key: unknown;
}

/** Soal tanpa kunci: MCQ tanpa answer_key, PAPI tanpa kode skala. */
export function sanitizeQuestions(kind: string, rows: QuestionRow[]) {
  if (kind === "forced_choice") {
    return rows.map((q) => {
      const pair = q.options as { a?: { text?: string }; b?: { text?: string } } | null;
      return {
        id: q.id,
        body: q.body,
        options: {
          a: { text: pair?.a?.text ?? "" },
          b: { text: pair?.b?.text ?? "" },
        },
      };
    });
  }
  return rows.map((q) => {
    const opts = Array.isArray(q.options) ? (q.options as { key: string; text: string }[]) : [];
    return { id: q.id, body: q.body, options: opts.map((o) => ({ key: o.key, text: o.text })) };
  });
}

/** jsonb answer_key MCQ dinarrow eksplisit, bukan di-cast. */
export function toMcqAnswerKey(value: unknown): { correct: string } | null {
  if (typeof value !== "object" || value === null) return null;
  const correct = (value as { correct?: unknown }).correct;
  return typeof correct === "string" ? { correct } : null;
}

export function toPapiOptions(value: unknown): { a: { scale: string }; b: { scale: string } } | null {
  if (typeof value !== "object" || value === null) return null;
  const pair = value as { a?: { scale?: unknown }; b?: { scale?: unknown } };
  if (typeof pair.a?.scale === "string" && typeof pair.b?.scale === "string") {
    return { a: { scale: pair.a.scale }, b: { scale: pair.b.scale } };
  }
  return null;
}

/** Hanya jawaban utk soal yang memang diundikan bagi tes ini. */
export function pickDrawnAnswers(
  test: Pick<PsikotesSessionTestRow, "answers">,
  answers: Record<string, string>
): Record<string, string> {
  const allowed = new Set(test.answers?.question_ids ?? []);
  return Object.fromEntries(Object.entries(answers).filter(([qid]) => allowed.has(qid)));
}

export async function getPortalSessionData(session: PsikotesSessionRow) {
  const tests = await query<PsikotesSessionTestRow>(
    `SELECT t.id, t.session_id, t.instrument_id, t.status, t.answers,
            t.attachment_path, t.sort_order, t.started_at, t.completed_at,
            i.code AS instrument_code, i.name AS instrument_name,
            i.kind AS instrument_kind, i.config AS instrument_config
     FROM recruitment.psikotes_session_tests t
     JOIN recruitment.psikotes_instruments i ON i.id = t.instrument_id
     WHERE t.session_id = $1
     ORDER BY t.sort_order, i.sort_order`,
    [session.id]
  );
  return {
    session: {
      status: session.status,
      candidate_name: session.candidate_name,
      position_title: session.position_title,
      webcam_consent: session.webcam_consent,
      expires_at: session.expires_at,
      started_at: session.started_at,
      completed_at: session.completed_at,
    },
    tests: tests.map(sanitizeTestForCandidate),
  };
}

/** draft/sent → in_progress + consent kamera. Idempoten utk sesi yang sudah berjalan. */
export async function startPsikotesSession(session: PsikotesSessionRow, request: Request) {
  if (session.status === "expired") throw new ApiError(410, "Link tes sudah kedaluwarsa");
  if (session.status === "completed") throw ApiError.conflict("Sesi tes sudah selesai");
  const { webcam_consent } = await parseJsonBody(request, sessionStartSchema, "Payload tidak valid");
  return queryOne(
    `UPDATE recruitment.psikotes_sessions SET
       status = 'in_progress',
       webcam_consent = $2,
       started_at = COALESCE(started_at, now())
     WHERE id = $1
     RETURNING id, status, webcam_consent, started_at`,
    [session.id, webcam_consent]
  );
}

/** Undi soal SEKALI (snapshot question_ids) supaya refresh/resume mendapat set yang sama. */
async function drawQuestionIds(test: PsikotesSessionTestRow): Promise<string[]> {
  if (test.instrument_kind === "drawing") return [];
  const config = test.instrument_config;
  const useShuffle = test.instrument_kind === "mcq" && config.shuffle;
  const limit =
    test.instrument_kind === "mcq" && config.question_count ? Math.max(1, config.question_count) : null;
  const rows = await query<{ id: string }>(
    `SELECT id FROM recruitment.psikotes_questions
     WHERE instrument_id = $1 AND is_active = true
     ORDER BY ${useShuffle ? "random()" : "sort_order, created_at"}
     ${limit ? "LIMIT $2" : ""}`,
    limit ? [test.instrument_id, limit] : [test.instrument_id]
  );
  if (rows.length === 0) throw ApiError.conflict("Bank soal instrumen ini kosong — hubungi HR");
  return rows.map((r) => r.id);
}

/** Mulai/lanjutkan satu instrumen; soal dikirim tanpa kunci jawaban. */
export async function startPsikotesTest(sessionId: string, initial: PsikotesSessionTestRow) {
  let test = initial;
  if (test.status !== "pending" && test.status !== "in_progress") {
    throw ApiError.conflict("Tes ini sudah diselesaikan");
  }

  if (test.status === "pending") {
    const questionIds = await drawQuestionIds(test);
    // conditional pada status: dua start yang balapan tidak boleh sama-sama
    // mengundi; yang kalah memakai hasil undian pemenang
    await queryOne(
      `UPDATE recruitment.psikotes_session_tests SET
         status = 'in_progress',
         started_at = COALESCE(started_at, now()),
         answers = $2::jsonb
       WHERE id = $1 AND status = 'pending' RETURNING id`,
      [test.id, JSON.stringify({ question_ids: questionIds, answers: {} })]
    );
    const reloaded = await loadSessionTest(sessionId, test.id);
    if (!reloaded) throw ApiError.notFound("Tes tidak ditemukan");
    test = reloaded;
  }

  let questions: ReturnType<typeof sanitizeQuestions> = [];
  const drawnIds = test.answers?.question_ids ?? [];
  if (test.instrument_kind !== "drawing" && drawnIds.length > 0) {
    const rows = await query<QuestionRow>(
      `SELECT id, body, options FROM recruitment.psikotes_questions WHERE id = ANY($1::uuid[])`,
      [drawnIds]
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    questions = sanitizeQuestions(
      test.instrument_kind,
      drawnIds.map((id) => byId.get(id)).filter((r): r is QuestionRow => Boolean(r))
    );
  }

  const deadline = testDeadlineMs(test);
  return {
    test: sanitizeTestForCandidate(test),
    questions,
    saved_answers: test.answers?.answers ?? {},
    ends_at: deadline ? new Date(deadline).toISOString() : null,
  };
}

function assertTestRunning(test: PsikotesSessionTestRow) {
  if (test.status !== "in_progress") throw ApiError.conflict("Tes tidak sedang berjalan");
  if (isPastAnswerGrace(test)) throw ApiError.conflict("Waktu tes sudah habis");
}

/** Autosave jawaban; ditolak setelah deadline + grace. Return jumlah jawaban tersimpan. */
export async function savePsikotesAnswers(test: PsikotesSessionTestRow, request: Request) {
  assertTestRunning(test);
  const { answers } = await parseJsonBody(request, sessionAnswersSchema, "Payload tidak valid");
  // guard status di UPDATE juga: autosave yang balapan dgn finish tidak
  // boleh menulis ke tes yang sudah terskor
  const updated = await queryOne<{ answers: { answers?: Record<string, string> } }>(
    `UPDATE recruitment.psikotes_session_tests SET
       answers = jsonb_set(answers, '{answers}', COALESCE(answers->'answers', '{}'::jsonb) || $2::jsonb)
     WHERE id = $1 AND status = 'in_progress'
     RETURNING answers`,
    [test.id, JSON.stringify(pickDrawnAnswers(test, answers))]
  );
  if (!updated) throw ApiError.conflict("Tes tidak sedang berjalan");
  return Object.keys(updated.answers?.answers ?? {}).length;
}

/** Body opsional {answers} = flush jawaban terakhir; body tak valid diabaikan. */
async function readFlushAnswers(request: Request): Promise<Record<string, string>> {
  const parsed = sessionAnswersSchema.safeParse(await request.json().catch(() => null));
  return parsed.success ? parsed.data.answers : {};
}

/**
 * Akhiri satu tes. Body {answers} (opsional) di-merge sebelum scoring supaya
 * tidak balapan dgn autosave terakhir.
 * mcq → skor 0–100; forced_choice → 20 skala PAPI; drawing → perlu_review.
 * Idempoten: tes yang sudah terminal mengembalikan status saat ini.
 */
export async function finishPsikotesTest(test: PsikotesSessionTestRow, request: Request) {
  if (TERMINAL_TEST_STATUSES.has(test.status)) {
    return { data: { status: test.status }, message: "Tes sudah selesai" };
  }
  if (test.status !== "in_progress") throw ApiError.conflict("Tes belum dimulai");

  if (test.instrument_kind === "drawing") {
    // setelah deadline finish tetap diterima walau tanpa gambar supaya sesi
    // tidak menggantung; HR melihat tidak ada lampiran
    if (!test.attachment_path && !isPastAnswerGrace(test)) {
      throw ApiError.badRequest("Unggah hasil gambar terlebih dahulu");
    }
    const updated = await queryOne(
      `UPDATE recruitment.psikotes_session_tests SET
         status = 'perlu_review', completed_at = now()
       WHERE id = $1 AND status = 'in_progress'
       RETURNING id, status, completed_at`,
      [test.id]
    );
    return { data: updated ?? { status: "perlu_review" }, message: "Tes selesai — menunggu review HR" };
  }

  const flush = pickDrawnAnswers(test, await readFlushAnswers(request));
  const finalAnswers = { ...(test.answers?.answers ?? {}), ...flush };
  const questions = await query<QuestionScoringRow>(
    `SELECT id, options, answer_key FROM recruitment.psikotes_questions
     WHERE id = ANY($1::uuid[])`,
    [test.answers?.question_ids ?? []]
  );

  let score: number | null = null;
  let scoreDetail: unknown;
  if (test.instrument_kind === "mcq") {
    const result = scoreMcq(
      questions.map((q) => ({ id: q.id, answer_key: toMcqAnswerKey(q.answer_key) })),
      finalAnswers
    );
    score = result.score;
    scoreDetail = result.detail;
  } else {
    scoreDetail = scorePapi(
      questions.map((q) => ({ id: q.id, options: toPapiOptions(q.options) })),
      finalAnswers
    );
  }

  // conditional pada status: dua finish yang balapan → hanya satu yang menulis skor
  const updated = await queryOne(
    `UPDATE recruitment.psikotes_session_tests SET
       status = 'selesai',
       answers = jsonb_set(answers, '{answers}', $2::jsonb),
       score = $3,
       score_detail = $4::jsonb,
       completed_at = now()
     WHERE id = $1 AND status = 'in_progress'
     RETURNING id, status, score, completed_at`,
    [test.id, JSON.stringify(finalAnswers), score, JSON.stringify(scoreDetail)]
  );
  return { data: updated ?? { id: test.id, status: "selesai" }, message: "Tes selesai" };
}

/**
 * Simpan foto hasil tes gambar ke storage PRIVATE. MIME klaim client bisa
 * dipalsukan, jadi isi byte yang menentukan. Upload ulang menimpa path lama.
 */
export async function uploadPsikotesDrawing(sessionId: string, test: PsikotesSessionTestRow, request: Request) {
  if (test.instrument_kind !== "drawing") throw ApiError.badRequest("Tes ini tidak menerima unggahan gambar");
  assertTestRunning(test);

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw ApiError.badRequest("File tidak ditemukan di form");
  if (!isAllowedImageMime(file.type)) throw ApiError.badRequest("Format harus JPG, PNG, atau WebP");
  if (file.size > MAX_DRAWING_BYTES) throw ApiError.badRequest("Ukuran file maksimal 8MB");

  const buffer = Buffer.from(await file.arrayBuffer());
  if (!sniffImageMime(buffer)) throw ApiError.badRequest("Isi file bukan gambar JPG/PNG/WebP yang valid");
  const saved = await savePrivateImage(buffer, file.type, `psikotes/${sessionId}/${test.id}`);
  if (!saved.path) throw new ApiError(500, saved.error ?? "Gagal menyimpan file");

  const replaced = await queryOne<{ id: string }>(
    `UPDATE recruitment.psikotes_session_tests SET attachment_path = $2
     WHERE id = $1 AND status = 'in_progress' RETURNING id`,
    [test.id, saved.path]
  );
  if (!replaced) {
    await deletePrivateFile(saved.path);
    throw ApiError.conflict("Tes tidak sedang berjalan");
  }
  // re-upload: file lama tidak boleh jadi yatim di disk
  if (test.attachment_path && test.attachment_path !== saved.path) {
    await deletePrivateFile(test.attachment_path);
  }
}

/**
 * Tutup sesi setelah SEMUA tes terminal; jejak 'psikotes_completed' ditulis
 * hanya oleh request yang memenangkan transisi (atribusi "Sistem").
 */
export async function finishPsikotesSession(session: PsikotesSessionRow) {
  const alreadyDone = { data: { status: "completed" }, message: "Sesi sudah selesai" };
  if (session.status === "completed") return alreadyDone;
  if (session.status !== "in_progress") throw ApiError.conflict("Sesi tidak sedang berjalan");

  const remaining = await query<{ name: string }>(
    `SELECT i.name FROM recruitment.psikotes_session_tests t
     JOIN recruitment.psikotes_instruments i ON i.id = t.instrument_id
     WHERE t.session_id = $1 AND t.status IN ('pending', 'in_progress')`,
    [session.id]
  );
  if (remaining.length > 0) {
    throw ApiError.badRequest(`Masih ada tes yang belum selesai: ${remaining.map((r) => r.name).join(", ")}`);
  }

  const updated = await withTransaction(async (client) => {
    const res = await client.query(
      `UPDATE recruitment.psikotes_sessions SET
         status = 'completed', completed_at = now()
       WHERE id = $1 AND status = 'in_progress'
       RETURNING id, status, completed_at`,
      [session.id]
    );
    if (res.rowCount === 0) return null;
    await client.query(
      `INSERT INTO recruitment.candidate_activities
         (candidate_id, activity_type, description, created_by, created_by_name)
       VALUES ($1, 'psikotes_completed', $2, NULL, 'Sistem')`,
      [session.candidate_id, "Kandidat menyelesaikan seluruh rangkaian psikotes online"]
    );
    return res.rows[0];
  });
  return updated ? { data: updated, message: "Seluruh tes selesai — terima kasih" } : alreadyDone;
}
