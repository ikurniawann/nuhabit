import { ApiError, type ApiUser } from "@/lib/api/auth";
import { query, queryOne, withTransaction } from "@/lib/db";
import { readPrivateFile } from "@/lib/storage-private";
import {
  instrumentUpdateSchema,
  mcqQuestionSchema,
  papiQuestionSchema,
  psikotesReviewSchema,
} from "@/lib/validations/psikotes";
import { DeepseekNotConfiguredError } from "./deepseek";
import { analyzeDrawingObservation, describeDrawingImage, OpenAiNotConfiguredError } from "./psikotes-ai";
import { logCandidateActivity } from "./candidates-repo";
import { parseJsonBody } from "./route-helpers";

/**
 * Sisi HR modul psikotes: bank soal & instrumen, rincian jawaban, review
 * manual, dan insight AI tes gambar. Kunci jawaban hanya keluar dari sini
 * (endpoint ber-auth HR); endpoint kandidat tidak pernah menyentuhnya.
 */

const QUESTION_FIELDS =
  "id, instrument_id, body, options, answer_key, sort_order, is_active, created_at, updated_at";

const REVIEWABLE = new Set(["perlu_review", "reviewed"]);

export function listInstruments() {
  return query(
    `SELECT i.id, i.code, i.name, i.kind, i.config, i.is_active, i.sort_order,
            i.created_at, i.updated_at,
            count(q.id)::int AS question_count,
            count(q.id) FILTER (WHERE q.is_active)::int AS active_question_count
     FROM recruitment.psikotes_instruments i
     LEFT JOIN recruitment.psikotes_questions q ON q.instrument_id = i.id
     GROUP BY i.id
     ORDER BY i.sort_order, i.name`
  );
}

/** `code` dan `kind` immutable; config di-merge (jsonb ||) supaya key lama tidak hilang. */
export async function updateInstrument(id: string, request: Request) {
  const input = await parseJsonBody(request, instrumentUpdateSchema);
  const updated = await queryOne(
    `UPDATE recruitment.psikotes_instruments SET
       name      = COALESCE($2, name),
       is_active = COALESCE($3, is_active),
       config    = CASE WHEN $4::jsonb IS NULL THEN config ELSE config || $4::jsonb END
     WHERE id = $1
     RETURNING id, code, name, kind, config, is_active, sort_order, created_at, updated_at`,
    [id, input.name ?? null, input.is_active ?? null, input.config ? JSON.stringify(input.config) : null]
  );
  if (!updated) throw ApiError.notFound("Instrumen tidak ditemukan");
  return updated;
}

async function requireInstrument(id: string) {
  const instrument = await queryOne<{ id: string; kind: string }>(
    "SELECT id, kind FROM recruitment.psikotes_instruments WHERE id = $1",
    [id]
  );
  if (!instrument) throw ApiError.notFound("Instrumen tidak ditemukan");
  return instrument;
}

/** Soal divalidasi sesuai kind instrumen (mcq vs forced_choice). */
async function parseQuestion(request: Request, kind: string) {
  const input = await parseJsonBody(request, kind === "mcq" ? mcqQuestionSchema : papiQuestionSchema);
  const answerKey = "answer_key" in input ? input.answer_key : null;
  return [
    input.body,
    JSON.stringify(input.options),
    answerKey ? JSON.stringify(answerKey) : null,
    input.sort_order,
    input.is_active,
  ];
}

export async function listQuestions(instrumentId: string) {
  await requireInstrument(instrumentId);
  return query(
    `SELECT ${QUESTION_FIELDS} FROM recruitment.psikotes_questions
     WHERE instrument_id = $1
     ORDER BY sort_order, created_at`,
    [instrumentId]
  );
}

export async function createQuestion(instrumentId: string, request: Request) {
  const instrument = await requireInstrument(instrumentId);
  if (instrument.kind === "drawing") {
    throw ApiError.badRequest("Instrumen tes gambar tidak memiliki bank soal — atur instruksi di config");
  }
  const values = await parseQuestion(request, instrument.kind);
  return queryOne(
    `INSERT INTO recruitment.psikotes_questions
       (instrument_id, body, options, answer_key, sort_order, is_active)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${QUESTION_FIELDS}`,
    [instrumentId, ...values]
  );
}

export async function updateQuestion(id: string, request: Request) {
  const existing = await queryOne<{ id: string; kind: string }>(
    `SELECT q.id, i.kind
     FROM recruitment.psikotes_questions q
     JOIN recruitment.psikotes_instruments i ON i.id = q.instrument_id
     WHERE q.id = $1`,
    [id]
  );
  if (!existing) throw ApiError.notFound("Soal tidak ditemukan");
  const values = await parseQuestion(request, existing.kind);
  return queryOne(
    `UPDATE recruitment.psikotes_questions SET
       body = $2, options = $3, answer_key = $4, sort_order = $5, is_active = $6
     WHERE id = $1
     RETURNING ${QUESTION_FIELDS}`,
    [id, ...values]
  );
}

/** Hard delete; hasil tes historis aman karena jawaban & skor disnapshot. */
export async function deleteQuestion(id: string) {
  const deleted = await queryOne<{ id: string }>(
    "DELETE FROM recruitment.psikotes_questions WHERE id = $1 RETURNING id",
    [id]
  );
  if (!deleted) throw ApiError.notFound("Soal tidak ditemukan");
  return deleted;
}

interface AnswerDetailTest {
  id: string;
  answers: { answers?: Record<string, string> } | null;
  score_detail: {
    per_question?: { id: string; given: string | null; correct_key: string; is_correct: boolean }[];
  } | null;
  instrument_id: string;
  instrument_kind: "mcq" | "forced_choice" | "drawing";
}

interface QuestionRow {
  id: string;
  body: string | null;
  options: unknown;
}

/**
 * Rincian soal + jawaban kandidat (MCQ & PAPI). Urutan MCQ mengikuti
 * snapshot score_detail.per_question; soal yang sudah dihapus → body null.
 */
export async function getTestAnswerDetail(id: string) {
  const test = await queryOne<AnswerDetailTest>(
    `SELECT t.id, t.answers, t.score_detail, t.instrument_id, i.kind AS instrument_kind
     FROM recruitment.psikotes_session_tests t
     JOIN recruitment.psikotes_instruments i ON i.id = t.instrument_id
     WHERE t.id = $1`,
    [id]
  );
  if (!test) throw ApiError.notFound("Tes tidak ditemukan");
  if (test.instrument_kind === "drawing") throw ApiError.badRequest("Tes gambar tidak memiliki rincian soal");

  if (test.instrument_kind === "mcq") {
    const perQuestion = test.score_detail?.per_question ?? [];
    if (perQuestion.length === 0) return { kind: "mcq", items: [] };
    const rows = await query<QuestionRow>(
      `SELECT id, body, options FROM recruitment.psikotes_questions WHERE id = ANY($1::uuid[])`,
      [perQuestion.map((p) => p.id)]
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    const items = perQuestion.map((p) => ({
      id: p.id,
      body: byId.get(p.id)?.body ?? null,
      options: byId.get(p.id)?.options ?? null,
      given: p.given,
      correct_key: p.correct_key,
      is_correct: p.is_correct,
    }));
    return { kind: "mcq", items };
  }

  // forced_choice (PAPI): seluruh pasangan aktif urut bank soal; pilihan
  // kandidat disimpan di answers.answers.
  const answers = test.answers?.answers ?? {};
  const rows = await query<QuestionRow>(
    `SELECT id, body, options FROM recruitment.psikotes_questions
     WHERE instrument_id = $1 AND is_active = true
     ORDER BY sort_order, created_at`,
    [test.instrument_id]
  );
  const items = rows.map((r) => {
    const given = answers[r.id];
    return { id: r.id, body: r.body, options: r.options ?? null, given: given === "a" || given === "b" ? given : null };
  });
  return { kind: "forced_choice", items };
}

/** Review manual tes proyektif; status reviewed + jejak aktivitas dalam satu transaksi. */
export async function reviewTest(id: string, request: Request, user: ApiUser) {
  const { review_notes } = await parseJsonBody(request, psikotesReviewSchema);
  const test = await queryOne<{ id: string; status: string; candidate_id: string; instrument_name: string }>(
    `SELECT t.id, t.status, s.candidate_id, i.name AS instrument_name
     FROM recruitment.psikotes_session_tests t
     JOIN recruitment.psikotes_sessions s ON s.id = t.session_id
     JOIN recruitment.psikotes_instruments i ON i.id = t.instrument_id
     WHERE t.id = $1`,
    [id]
  );
  if (!test) throw ApiError.notFound("Tes tidak ditemukan");
  if (!REVIEWABLE.has(test.status)) throw ApiError.conflict("Tes ini tidak dalam antrian review manual");

  return withTransaction(async (client) => {
    const res = await client.query(
      `UPDATE recruitment.psikotes_session_tests SET
         status = 'reviewed', review_notes = $2, reviewed_by = $3, reviewed_by_name = $4
       WHERE id = $1
       RETURNING id, status, review_notes, reviewed_by_name`,
      [id, review_notes, user.id, user.full_name]
    );
    await logCandidateActivity(
      test.candidate_id,
      "psikotes_reviewed",
      `Hasil tes ${test.instrument_name} direview manual`,
      user,
      client
    );
    return res.rows[0];
  });
}

interface InsightTest {
  status: string;
  attachment_path: string | null;
  instrument_code: string;
  instrument_name: string;
  instrument_kind: string;
  position_title: string | null;
}

/** Observasi objektif dari gambar via OpenAI vision (mode otomatis). */
async function describeAttachment(test: InsightTest) {
  if (!test.attachment_path) {
    throw ApiError.badRequest("Tes ini tidak punya gambar terunggah — tulis observasi manual");
  }
  const { data, mime } = await readPrivateFile(test.attachment_path);
  if (!data) throw ApiError.notFound("Berkas gambar tidak ditemukan di storage — tulis observasi manual");
  return describeDrawingImage({
    instrumentCode: test.instrument_code,
    instrumentName: test.instrument_name,
    imageBase64: data.toString("base64"),
    imageMime: mime ?? "image/png",
  });
}

/**
 * Insight AI tes gambar Baum/DAP/Wartegg. Observasi diisi → mode manual;
 * kosong → OpenAI vision membaca gambar lalu DeepSeek membuat insight.
 * Hasil indikatif, di-cache di kolom ai_insight dan bisa digenerate ulang.
 */
export async function createDrawingInsight(id: string, manualObservation: string, user: ApiUser) {
  const test = await queryOne<InsightTest>(
    `SELECT t.status, t.attachment_path,
            i.code AS instrument_code, i.name AS instrument_name,
            i.kind AS instrument_kind, p.title AS position_title
     FROM recruitment.psikotes_session_tests t
     JOIN recruitment.psikotes_instruments i ON i.id = t.instrument_id
     JOIN recruitment.psikotes_sessions s ON s.id = t.session_id
     JOIN recruitment.candidates c ON c.id = s.candidate_id
     LEFT JOIN hris.positions p ON p.id = c.position_id
     WHERE t.id = $1`,
    [id]
  );
  if (!test) throw ApiError.notFound("Tes tidak ditemukan");
  if (test.instrument_kind !== "drawing") {
    throw ApiError.badRequest("Insight AI hanya untuk tes gambar (Baum/DAP/Wartegg)");
  }
  if (!REVIEWABLE.has(test.status)) throw ApiError.conflict("Tes belum selesai dikerjakan kandidat");

  try {
    let observation = manualObservation;
    let observationSource: "manual" | "ai" = "manual";
    let visionModel: string | null = null;
    if (!observation) {
      const described = await describeAttachment(test);
      observation = described.observation.slice(0, 4000);
      observationSource = "ai";
      visionModel = described.model;
    }

    const { result, model } = await analyzeDrawingObservation({
      instrumentCode: test.instrument_code,
      instrumentName: test.instrument_name,
      observation,
      positionTitle: test.position_title,
    });
    const aiInsight = {
      observation,
      observation_source: observationSource,
      vision_model: visionModel,
      insight: result,
      model,
      created_at: new Date().toISOString(),
      created_by_name: user.full_name,
    };
    await queryOne(
      `UPDATE recruitment.psikotes_session_tests SET ai_insight = $2::jsonb WHERE id = $1 RETURNING id`,
      [id, JSON.stringify(aiInsight)]
    );
    return aiInsight;
  } catch (error) {
    if (error instanceof DeepseekNotConfiguredError || error instanceof OpenAiNotConfiguredError) {
      throw ApiError.badRequest(error.message);
    }
    throw error;
  }
}
