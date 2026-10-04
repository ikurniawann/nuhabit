import { z } from "zod";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { query, queryOne, withTransaction } from "@/lib/db";
import { IAM } from "@/lib/iam/prefixes";
import { isDirectSubordinate } from "./team";
import { getWorkforceActor } from "./workforce-auth";
import { DATE_RE, UUID_RE } from "./workforce-route";

/**
 * Pola jadwal shift mingguan per karyawan (hris.employee_shifts).
 * Permintaan owner 2026-08-29: selain HRD, atasan langsung (reporting_to)
 * boleh melihat & mengatur jadwal anggota timnya sendiri.
 */

/** Lolos bila punya menu HR (kepegawaian/workforce) ATAU atasan langsung target. */
export async function authorizeShiftManager(targetEmployeeId: string): Promise<{ actorName: string }> {
  try {
    const user = await requireIamMenuPrefix([...IAM.hrisKepegawaian, ...IAM.hrisWorkforce]);
    return { actorName: user.full_name };
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
  }
  const actor = await getWorkforceActor();
  if (!actor?.employeeId) throw ApiError.unauthorized("Unauthorized");
  if (!(await isDirectSubordinate(actor.employeeId, targetEmployeeId))) {
    throw ApiError.forbidden(
      "Hanya HRD atau atasan langsung yang boleh mengatur jadwal karyawan ini"
    );
  }
  const me = await queryOne<{ full_name: string }>(
    `SELECT full_name FROM hris.employees WHERE id = $1`,
    [actor.employeeId]
  );
  return { actorName: me?.full_name || "Atasan" };
}

const DATE_MESSAGE = "Tanggal mulai berlaku wajib diisi (YYYY-MM-DD)";
const DAYS_MESSAGE = "Pola jadwal harus lengkap 7 hari (Senin–Minggu)";

export const shiftPatternSchema = z.object({
  effective_from: z.string({ error: DATE_MESSAGE }).regex(DATE_RE, DATE_MESSAGE),
  days: z
    .array(
      z.object({
        day_of_week: z.number({ error: DAYS_MESSAGE }).int(DAYS_MESSAGE).min(1, DAYS_MESSAGE).max(7, DAYS_MESSAGE),
        shift_id: z.string().regex(UUID_RE, "ID shift tidak valid").nullable().optional(),
      }),
      { error: DAYS_MESSAGE }
    )
    .length(7, DAYS_MESSAGE)
    .refine((days) => new Set(days.map((d) => d.day_of_week)).size === 7, DAYS_MESSAGE),
});

export type ShiftPattern = z.infer<typeof shiftPatternSchema>;

export async function listEmployeeShifts(employeeId: string) {
  return query(
    `SELECT es.id, es.day_of_week, es.shift_id, es.effective_from, es.effective_to,
            s.name AS shift_name, s.start_time, s.end_time
     FROM hris.employee_shifts es
     LEFT JOIN hris.shifts s ON s.id = es.shift_id
     WHERE es.employee_id = $1
     ORDER BY es.effective_from DESC, es.day_of_week ASC`,
    [employeeId]
  );
}

/**
 * Set pola mingguan baru sejak effective_from: pola yang mulai pada/setelah
 * tanggal itu digantikan, pola berjalan ditutup sehari sebelumnya.
 */
export async function saveShiftPattern(employeeId: string, pattern: ShiftPattern, actorName: string) {
  await withTransaction(async (client) => {
    await client.query(
      `DELETE FROM hris.employee_shifts
       WHERE employee_id = $1 AND effective_from >= $2`,
      [employeeId, pattern.effective_from]
    );
    await client.query(
      `UPDATE hris.employee_shifts
       SET effective_to = ($2::date - 1)
       WHERE employee_id = $1 AND effective_from < $2
         AND (effective_to IS NULL OR effective_to >= $2)`,
      [employeeId, pattern.effective_from]
    );
    for (const day of pattern.days) {
      await client.query(
        `INSERT INTO hris.employee_shifts
           (employee_id, day_of_week, shift_id, effective_from, created_by_name)
         VALUES ($1, $2, $3, $4, $5)`,
        [employeeId, day.day_of_week, day.shift_id ?? null, pattern.effective_from, actorName]
      );
    }
  });
}
