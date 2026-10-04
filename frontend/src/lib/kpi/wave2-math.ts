import type { CollectorValue } from "./collectors";

/**
 * Helper murni kolektor gelombang 2 (EPIC-010 Fase D).
 */

/**
 * team_ontime: rata-rata rasio on-time anggota per department.
 * Anggota tanpa data tidak ikut rata-rata; dept tanpa data sama sekali absen.
 */
export function computeTeamOntime(
  employees: { id: string; department_id: string | null }[],
  ontimeByEmployee: Map<string, number>
): Map<string, CollectorValue & { actual: number }> {
  const sums = new Map<string, { total: number; n: number }>();
  for (const employee of employees) {
    if (!employee.department_id) continue;
    const ontime = ontimeByEmployee.get(employee.id);
    if (ontime === undefined) continue;
    const entry = sums.get(employee.department_id) ?? { total: 0, n: 0 };
    entry.total += ontime;
    entry.n += 1;
    sums.set(employee.department_id, entry);
  }

  const result = new Map<string, CollectorValue & { actual: number }>();
  for (const [departmentId, { total, n }] of sums) {
    result.set(departmentId, {
      actual: total / n,
      sampleSize: n,
      sourceDetail: { members_with_data: n },
    });
  }
  return result;
}

export interface ShiftDuration {
  start_time: string; // HH:MM:SS
  end_time: string;
  break_minutes: number | null;
  is_overnight: boolean | null;
}

const toMinutes = (time: string): number => {
  const [hour, minute] = time.split(":").map(Number);
  return (hour || 0) * 60 + (minute || 0);
};

/** Menit kerja terjadwal satu shift: (end − start, lintas-malam aware) − break. */
export function scheduledMinutesForShift(shift: ShiftDuration): number {
  const start = toMinutes(shift.start_time);
  let end = toMinutes(shift.end_time);
  if (shift.is_overnight) end += 24 * 60;
  const gross = end - start;
  return Math.max(0, gross - (shift.break_minutes ?? 0));
}
