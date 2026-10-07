/**
 * Rata-rata skor scorecard 3 periode terakhir per karyawan: decision support
 * perpanjangan kontrak PKWT (EPIC-010 Fase D). Keputusan tetap di manusia.
 */

import { query } from "@/lib/db";

export interface KpiRecommendation {
  avg_score: number;
  periods: number;
  has_final: boolean;
}

/** Daftar id dari parameter "a,b,c": dipangkas, kosong dibuang, maks 200. */
export function parseEmployeeIds(raw: string | undefined): string[] {
  return (raw || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, 200);
}

export async function loadKpiRecommendations(
  employeeIds: string[]
): Promise<Record<string, KpiRecommendation>> {
  if (employeeIds.length === 0) return {};
  const rows = await query<{
    employee_id: string;
    avg_score: number;
    periods: number;
    has_final: boolean;
  }>(
    `WITH ranked AS (
       SELECT employee_id, score::float AS score, status,
              ROW_NUMBER() OVER (
                PARTITION BY employee_id
                ORDER BY period_year DESC, period_month DESC
              ) AS rn
       FROM performance.kpi_scorecards
       WHERE employee_id = ANY($1::uuid[]) AND score IS NOT NULL
     )
     SELECT employee_id,
            AVG(score)::float AS avg_score,
            COUNT(*)::int AS periods,
            BOOL_OR(status = 'final') AS has_final
     FROM ranked WHERE rn <= 3
     GROUP BY employee_id`,
    [employeeIds]
  );
  return Object.fromEntries(
    rows.map((row) => [
      row.employee_id,
      {
        avg_score: Math.round(row.avg_score * 100) / 100,
        periods: row.periods,
        has_final: row.has_final,
      },
    ])
  );
}
