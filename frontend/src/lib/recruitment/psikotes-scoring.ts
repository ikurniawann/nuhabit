import { PAPI_SCALES, PAPI_SCALE_CODES, type PapiScaleCode } from "./psikotes";

/**
 * Scoring server-side psikotes (EPIC-002 TG3).
 * Kunci jawaban TIDAK pernah dikirim ke client — semua penilaian di sini.
 * Hasil `per_question` / `scales` disimpan sebagai snapshot di
 * `psikotes_session_tests.score_detail` supaya riwayat tetap utuh walau
 * bank soal berubah/dihapus belakangan.
 */

export interface McqScoringQuestion {
  id: string;
  answer_key: { correct: string } | null;
}

export interface McqScoreResult {
  /** 0–100, dibulatkan */
  score: number;
  detail: {
    total: number;
    correct: number;
    per_question: {
      id: string;
      given: string | null;
      correct_key: string;
      is_correct: boolean;
    }[];
  };
}

export function scoreMcq(
  questions: McqScoringQuestion[],
  answers: Record<string, string>
): McqScoreResult {
  const scorable = questions.filter(
    (q): q is McqScoringQuestion & { answer_key: { correct: string } } =>
      Boolean(q.answer_key?.correct)
  );

  const perQuestion = scorable.map((q) => {
    const given = answers[q.id] ?? null;
    return {
      id: q.id,
      given,
      correct_key: q.answer_key.correct,
      is_correct: given !== null && given === q.answer_key.correct,
    };
  });

  const correct = perQuestion.filter((p) => p.is_correct).length;
  const total = perQuestion.length;

  return {
    score: total === 0 ? 0 : Math.round((correct / total) * 100),
    detail: { total, correct, per_question: perQuestion },
  };
}

export interface PapiScoringQuestion {
  id: string;
  options: { a: { scale: string }; b: { scale: string } } | null;
}

export interface PapiScoreResult {
  /** jumlah pilihan per skala (20 skala PAPI, 0 jika tak pernah dipilih) */
  scales: Record<PapiScaleCode, number>;
  /** skala dengan count tertinggi (bisa lebih dari satu jika seri), urut kode */
  dominant: { code: PapiScaleCode; label: string; count: number }[];
  answered: number;
  total: number;
}

function isPapiScale(scale: string): scale is PapiScaleCode {
  return scale in PAPI_SCALES;
}

export function scorePapi(
  questions: PapiScoringQuestion[],
  answers: Record<string, string>
): PapiScoreResult {
  const scales = Object.fromEntries(PAPI_SCALE_CODES.map((c) => [c, 0])) as Record<
    PapiScaleCode,
    number
  >;

  const scorable = questions.filter(
    (q): q is PapiScoringQuestion & { options: NonNullable<PapiScoringQuestion["options"]> } =>
      Boolean(q.options?.a?.scale && q.options?.b?.scale)
  );

  let answered = 0;
  for (const q of scorable) {
    const choice = answers[q.id];
    if (choice !== "a" && choice !== "b") continue;
    const scale = q.options[choice].scale;
    if (!isPapiScale(scale)) continue;
    scales[scale] += 1;
    answered += 1;
  }

  const maxCount = Math.max(0, ...Object.values(scales));
  const dominant =
    maxCount === 0
      ? []
      : PAPI_SCALE_CODES.filter((c) => scales[c] === maxCount).map((code) => ({
          code,
          label: PAPI_SCALES[code],
          count: maxCount,
        }));

  return { scales, dominant, answered, total: scorable.length };
}
