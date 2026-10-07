import { getPool } from "@/lib/db";

/**
 * Performance Review kuartalan (owner 2026-08-31, Fase 1).
 * Nilai akhir = gabungan berbobot:
 *   Hasil Kerja 60%  — rata-rata skor KPI scorecard bulanan dalam kuartal
 *                      (otomatis, tidak bisa diedit manual)
 *   Perilaku   30%  — rata-rata tertimbang skor 1–5 per kompetensi dari
 *                      Head Division, diskalakan ke 0–100
 *   Kontribusi 10%  — nilai proyek/kontribusi khusus dari reviewer (opsional)
 * Komponen yang belum ada nilainya tidak dihitung nol — bobotnya
 * didistribusikan ulang ke komponen yang ada (pola mesin KPI).
 */

export const REVIEW_WEIGHTS = { work: 60, behavior: 30, project: 10 } as const;

export function quarterMonths(quarter: number): number[] {
  const start = (quarter - 1) * 3 + 1;
  return [start, start + 1, start + 2];
}

export function quarterRange(year: number, quarter: number): { start: string; end: string } {
  const months = quarterMonths(quarter);
  const lastMonth = months[2];
  const lastDay = new Date(Date.UTC(year, lastMonth, 0)).getUTCDate();
  const mm = (m: number) => String(m).padStart(2, "0");
  return {
    start: `${year}-${mm(months[0])}-01`,
    end: `${year}-${mm(lastMonth)}-${lastDay}`,
  };
}

export function quarterLabel(year: number, quarter: number): string {
  return `Q${quarter} ${year}`;
}

/** Gabungan berbobot dengan redistribusi komponen kosong (null). */
export function combineReviewScores(input: {
  work: number | null;
  behavior: number | null;
  project: number | null;
}): number | null {
  const parts: { value: number; weight: number }[] = [];
  if (input.work !== null) parts.push({ value: input.work, weight: REVIEW_WEIGHTS.work });
  if (input.behavior !== null) parts.push({ value: input.behavior, weight: REVIEW_WEIGHTS.behavior });
  if (input.project !== null) parts.push({ value: input.project, weight: REVIEW_WEIGHTS.project });
  const totalWeight = parts.reduce((sum, p) => sum + p.weight, 0);
  if (totalWeight === 0) return null;
  const score = parts.reduce((sum, p) => sum + p.value * (p.weight / totalWeight), 0);
  return Math.round(score * 100) / 100;
}

/** Skor perilaku 0–100 dari item 1–5 bertimbang; null bila belum ada yang dinilai. */
export function behaviorScore(
  items: { score: number | null; weight: number | string }[]
): number | null {
  const scored = items.filter((it) => it.score !== null && Number(it.weight) > 0);
  if (scored.length === 0) return null;
  const totalWeight = scored.reduce((sum, it) => sum + Number(it.weight), 0);
  if (totalWeight <= 0) return null;
  const avg = scored.reduce(
    (sum, it) => sum + (Number(it.score) / 5) * 100 * (Number(it.weight) / totalWeight),
    0
  );
  return Math.round(avg * 100) / 100;
}

/**
 * Hitung ulang total sebuah review dari sumber kebenarannya lalu simpan.
 * Aman dipanggil berulang; review final tidak disentuh.
 */
export async function recalcReview(reviewId: string): Promise<void> {
  const pool = getPool();
  const reviewRes = await pool.query(
    `SELECT r.id, r.employee_id, r.status, r.total_project_score,
            c.period_year, c.period_quarter
     FROM performance.performance_reviews r
     JOIN performance.review_cycles c ON c.id = r.cycle_id
     WHERE r.id = $1`,
    [reviewId]
  );
  const review = reviewRes.rows[0];
  if (!review || review.status === "final") return;

  const months = quarterMonths(Number(review.period_quarter));
  const [workRes, itemsRes] = await Promise.all([
    pool.query(
      `SELECT AVG(score)::numeric(6,2) AS avg_score
       FROM performance.kpi_scorecards
       WHERE employee_id = $1 AND period_year = $2
         AND period_month = ANY($3::int[]) AND score IS NOT NULL`,
      [review.employee_id, review.period_year, months]
    ),
    pool.query(
      `SELECT score, weight FROM performance.behavioral_review_items WHERE review_id = $1`,
      [reviewId]
    ),
  ]);
  const work =
    workRes.rows[0]?.avg_score !== null && workRes.rows[0]?.avg_score !== undefined
      ? Number(workRes.rows[0].avg_score)
      : null;
  const behavior = behaviorScore(itemsRes.rows);
  const project =
    review.total_project_score === null || Number(review.total_project_score) === 0
      ? null
      : Number(review.total_project_score);
  const grand = combineReviewScores({ work, behavior, project });

  await pool.query(
    `UPDATE performance.performance_reviews
     SET total_work_result_score = $2,
         total_behavioral_score = $3,
         grand_total_score = $4,
         category = (
           SELECT category_name FROM performance.performance_categories
           WHERE $4::numeric BETWEEN min_score AND max_score
           ORDER BY min_score DESC LIMIT 1
         ),
         updated_at = now()
     WHERE id = $1`,
    [reviewId, work ?? 0, behavior ?? 0, grand]
  );
}
