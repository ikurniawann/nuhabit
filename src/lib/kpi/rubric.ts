/**
 * Penilaian atasan (rubrik 1–5) untuk satu karyawan-periode: disimpan sebagai
 * kpi_snapshot manual lalu scorecard disusun ulang. Akses: pengelola KPI
 * (HRD/admin) atau atasan langsung karyawan tsb (Fase E).
 */

import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import type { WorkforceActor } from "@/lib/hris/workforce-auth";
import { computeAttainment } from "./attainment";
import { KPI_MANAGE_ROLES } from "./roles";
import { recomposeScorecard } from "./snapshot";

const RUBRIC_CODE = "supervisor_rubric";
export const RUBRIC_MAX = 5;
const NOTES_MAX = 2000;
const INCOMPLETE = "Parameter tidak lengkap";
const VALUE_RANGE = `Nilai rubrik harus 1-${RUBRIC_MAX}`;

export const rubricSchema = z.object({
  employee_id: z.string({ error: INCOMPLETE }).min(1, INCOMPLETE),
  period_month: z.coerce.number({ error: INCOMPLETE }).int(INCOMPLETE).min(1, INCOMPLETE).max(12, INCOMPLETE),
  period_year: z.coerce.number({ error: INCOMPLETE }).int(INCOMPLETE),
  value: z.coerce.number({ error: VALUE_RANGE }).min(1, VALUE_RANGE).max(RUBRIC_MAX, VALUE_RANGE),
  // Catatan dipotong, bukan ditolak, bila terlalu panjang
  notes: z.unknown().optional().transform((v) => (typeof v === "string" ? v.slice(0, NOTES_MAX) : null)),
});

export async function saveRubric(actor: WorkforceActor, input: z.infer<typeof rubricSchema>) {
  const { employee_id: employeeId, period_year: periodYear, period_month: periodMonth } = input;

  if (!(KPI_MANAGE_ROLES as readonly string[]).includes(actor.role)) {
    const target = await queryOne<{ reporting_to: string | null }>(
      `SELECT reporting_to FROM hris.employees WHERE id = $1`,
      [employeeId]
    );
    if (!actor.employeeId || (target?.reporting_to ?? null) !== actor.employeeId) {
      throw ApiError.forbidden("Hanya HRD atau atasan langsung yang boleh menilai");
    }
  }

  const [indicator, scorecard] = await Promise.all([
    queryOne<{ id: string }>(`SELECT id FROM performance.kpi_indicators WHERE code = $1`, [RUBRIC_CODE]),
    queryOne<{ status: string }>(
      `SELECT status FROM performance.kpi_scorecards
       WHERE employee_id = $1 AND period_year = $2 AND period_month = $3`,
      [employeeId, periodYear, periodMonth]
    ),
  ]);
  if (!indicator) throw new Error("Indikator rubrik tidak ditemukan");
  if (scorecard?.status === "final") {
    throw ApiError.conflict("Scorecard sudah final — buka kembali dulu untuk mengubah rubrik");
  }

  const attainment = computeAttainment({
    direction: "higher_better",
    actual: input.value,
    target: RUBRIC_MAX,
  });
  await query(
    `INSERT INTO performance.kpi_snapshots
       (employee_id, indicator_id, period_year, period_month,
        actual, target, attainment, sample_size, source_detail)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 1, $8)
     ON CONFLICT (employee_id, indicator_id, period_year, period_month)
     DO UPDATE SET actual = EXCLUDED.actual, target = EXCLUDED.target,
       attainment = EXCLUDED.attainment,
       source_detail = EXCLUDED.source_detail, updated_at = now()`,
    [
      employeeId,
      indicator.id,
      periodYear,
      periodMonth,
      input.value,
      RUBRIC_MAX,
      attainment,
      JSON.stringify({ rated_by: actor.userId, notes: input.notes ?? null }),
    ]
  );

  const result = await recomposeScorecard({ employeeId, periodYear, periodMonth });
  return { score: result.score, status: result.status };
}
