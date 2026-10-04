import { query } from "@/lib/db";
import { deriveRosterStatus, isOverdue, type RosterStatus } from "./daily-roster";
import { isoDayOfWeek } from "./shifts";

/**
 * Roster kehadiran satu hari utk monitoring HRD: semua karyawan aktif +
 * shift terjadwalnya, siapa sudah/belum absen, terlambat, cuti, libur, atau
 * tanpa jadwal. Shift malam masuk roster pada tanggal MULAI shiftnya,
 * konsisten dengan kolom `date` saat clock-in.
 */

export interface RosterQueryRow {
  employee_id: string;
  full_name: string;
  nip: string | null;
  photo_url: string | null;
  department_name: string | null;
  job_title: string | null;
  has_schedule: boolean;
  scheduled_shift_id: string | null;
  shift_name: string | null;
  shift_start: string | null;
  shift_end: string | null;
  late_tolerance_minutes: number | null;
  is_overnight: boolean | null;
  attendance_id: string | null;
  clock_in: string | null;
  clock_out: string | null;
  work_hours: string | null;
  is_late: boolean | null;
  late_minutes: number | null;
  clock_in_photo_url: string | null;
  clock_out_photo_url: string | null;
  attendance_shift_id: string | null;
  leave_id: string | null;
  leave_type: string | null;
}

export type RosterSummary = Record<RosterStatus | "scheduled", number>;

const emptySummary = (): RosterSummary => ({
  scheduled: 0,
  hadir: 0,
  terlambat: 0,
  belum_absen: 0,
  absen: 0,
  cuti: 0,
  libur_nasional: 0,
  libur: 0,
  tanpa_jadwal: 0,
});

/** Baris query → entri roster + ringkasan per status (murni). */
export function buildRoster(
  rows: readonly RosterQueryRow[],
  context: { date: string; today: string; isPublicHoliday: boolean; now: Date }
) {
  const summary = emptySummary();
  const isPastDate = context.date < context.today;

  const employees = rows.map((row) => {
    const shift =
      row.scheduled_shift_id && row.shift_start && row.shift_end
        ? {
            id: row.scheduled_shift_id,
            name: row.shift_name ?? "",
            start_time: row.shift_start,
            end_time: row.shift_end,
            late_tolerance_minutes: row.late_tolerance_minutes ?? 0,
            is_overnight: row.is_overnight ?? false,
          }
        : null;

    const status = deriveRosterStatus({
      hasAttendance: row.attendance_id !== null,
      isLate: row.is_late ?? false,
      onApprovedLeave: row.leave_id !== null,
      hasSchedule: row.has_schedule,
      shiftId: row.scheduled_shift_id,
      isPastDate,
      isPublicHoliday: context.isPublicHoliday,
    });
    summary[status] += 1;
    if (shift) summary.scheduled += 1;

    return {
      employee_id: row.employee_id,
      full_name: row.full_name,
      nip: row.nip,
      photo_url: row.photo_url,
      department_name: row.department_name,
      job_title: row.job_title,
      shift,
      status,
      is_overdue: isOverdue(context.now, context.date, shift, status),
      attendance: row.attendance_id
        ? {
            id: row.attendance_id,
            clock_in: row.clock_in,
            clock_out: row.clock_out,
            work_hours: row.work_hours ? Number(row.work_hours) : null,
            is_late: row.is_late ?? false,
            late_minutes: row.late_minutes ?? 0,
            clock_in_photo_url: row.clock_in_photo_url,
            clock_out_photo_url: row.clock_out_photo_url,
            shift_id: row.attendance_shift_id,
          }
        : null,
      leave: row.leave_id ? { id: row.leave_id, leave_type: row.leave_type } : null,
    };
  });

  return { summary, employees };
}

export async function loadDailyRoster(date: string, today: string) {
  const dow = isoDayOfWeek(date);
  const [rows, shifts, holidays] = await Promise.all([
    query<RosterQueryRow>(
      `WITH scheduled AS (
         SELECT DISTINCT ON (es.employee_id)
                es.employee_id, es.shift_id
         FROM hris.employee_shifts es
         WHERE es.day_of_week = $2
           AND es.effective_from <= $1::date
           AND (es.effective_to IS NULL OR es.effective_to >= $1::date)
         ORDER BY es.employee_id, es.effective_from DESC
       )
       SELECT e.id AS employee_id, e.full_name, e.nip, e.photo_url,
              d.name AS department_name, p.title AS job_title,
              (sc.employee_id IS NOT NULL) AS has_schedule,
              sc.shift_id AS scheduled_shift_id,
              s.name AS shift_name,
              s.start_time::text AS shift_start,
              s.end_time::text AS shift_end,
              s.late_tolerance_minutes, s.is_overnight,
              a.id AS attendance_id, a.clock_in, a.clock_out,
              a.work_hours::text, a.is_late, a.late_minutes,
              a.clock_in_photo_url, a.clock_out_photo_url,
              a.shift_id AS attendance_shift_id,
              l.id AS leave_id, l.leave_type::text
       FROM hris.employees e
       LEFT JOIN scheduled sc ON sc.employee_id = e.id
       LEFT JOIN hris.shifts s ON s.id = sc.shift_id
       LEFT JOIN hris.attendance a
         ON a.employee_id = e.id AND a.date = $1::date
       LEFT JOIN LATERAL (
         SELECT lv.id, lv.leave_type
         FROM hris.leaves lv
         WHERE lv.employee_id = e.id AND lv.status = 'approved'
           AND lv.start_date <= $1::date AND lv.end_date >= $1::date
         ORDER BY lv.created_at DESC LIMIT 1
       ) l ON true
       LEFT JOIN hris.departments d ON d.id = e.department_id
       LEFT JOIN hris.positions p ON p.id = e.job_title_id
       WHERE e.is_active
         AND NOT EXISTS (
           SELECT 1 FROM configuration.users u
           WHERE u.id = e.user_id AND u.role = 'super_admin')
       ORDER BY e.full_name`,
      [date, dow]
    ),
    query<{
      id: string;
      name: string;
      start_time: string;
      end_time: string;
      is_overnight: boolean;
      sort_order: number | null;
    }>(
      `SELECT id, name, start_time::text, end_time::text, is_overnight, sort_order
       FROM hris.shifts WHERE is_active
       ORDER BY sort_order NULLS LAST, start_time`
    ),
    // Hari libur aktif pada tanggal ini; baris draft sengaja diabaikan.
    query<{ name: string; type: string }>(
      `SELECT name, type FROM hris.public_holidays
       WHERE deleted_at IS NULL AND status = 'aktif' AND holiday_date = $1::date
       ORDER BY name`,
      [date]
    ),
  ]);

  const { summary, employees } = buildRoster(rows, {
    date,
    today,
    isPublicHoliday: holidays.length > 0,
    now: new Date(),
  });

  return {
    date,
    day_of_week: dow,
    is_today: date === today,
    summary,
    shifts,
    holidays,
    employees,
  };
}
