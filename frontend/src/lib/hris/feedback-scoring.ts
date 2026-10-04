/**
 * Nilai akhir 360 feedback: gabungan skor KPI dan skor 360 berbobot siklus
 * (default 70/30 bila siklus tidak mengatur), lalu dipetakan ke grade A–E.
 */

const DEFAULT_KPI_WEIGHT = 70;
const DEFAULT_FEEDBACK_WEIGHT = 30;

export function finalGrade(score: number): "A" | "B" | "C" | "D" | "E" {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "E";
}

export function computeFinalScore(
  kpiScore: number,
  overall360Score: number,
  weights: { kpi_weight?: number | null; feedback_weight?: number | null } | null
): { final_score: number; final_grade: string } {
  const kpiWeight = weights?.kpi_weight || DEFAULT_KPI_WEIGHT;
  const feedbackWeight = weights?.feedback_weight || DEFAULT_FEEDBACK_WEIGHT;
  const finalScore = kpiScore * (kpiWeight / 100) + overall360Score * (feedbackWeight / 100);
  return { final_score: finalScore, final_grade: finalGrade(finalScore) };
}
