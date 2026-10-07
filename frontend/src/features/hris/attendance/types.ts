export interface AttendanceExportParams {
  employee_id?: string;
  status?: string;
  start_date?: string;
  end_date?: string;
}

// ── Roster harian (monitoring HRD) ──────────────────────────────────────
export type RosterStatus =
  | "hadir"
  | "terlambat"
  | "belum_absen"
  | "absen"
  | "cuti"
  | "libur_nasional"
  | "libur"
  | "tanpa_jadwal";

export interface RosterShift {
  id: string;
  name: string;
  start_time: string; // "HH:MM:SS"
  end_time: string;
  late_tolerance_minutes: number;
  is_overnight: boolean;
}

export interface RosterAttendance {
  id: string;
  clock_in: string | null;
  clock_out: string | null;
  work_hours: number | null;
  is_late: boolean;
  late_minutes: number;
  clock_in_photo_url: string | null;
  clock_out_photo_url: string | null;
  shift_id: string | null;
}

export interface RosterEmployee {
  employee_id: string;
  full_name: string;
  nip: string | null;
  photo_url: string | null;
  department_name: string | null;
  job_title: string | null;
  shift: RosterShift | null;
  status: RosterStatus;
  is_overdue: boolean;
  attendance: RosterAttendance | null;
  leave: { id: string; leave_type: string | null } | null;
}

export interface DailyRosterData {
  date: string;
  day_of_week: number;
  is_today: boolean;
  summary: Record<RosterStatus | "scheduled", number>;
  shifts: {
    id: string;
    name: string;
    start_time: string;
    end_time: string;
    is_overnight: boolean;
    sort_order: number | null;
  }[];
  /** Hari libur aktif pada tanggal roster (EPIC-036) — kosong bila hari kerja. */
  holidays: { name: string; type: string }[];
  employees: RosterEmployee[];
}

// ── Rekap (list absensi) ────────────────────────────────────────────────
export interface AttendanceListParams {
  employee_id?: string;
  start_date?: string;
  end_date?: string;
  is_late?: boolean;
  page?: number;
  limit?: number;
}

export interface AttendanceListRow {
  id: string;
  employee_id: string;
  date: string;
  clock_in: string | null;
  clock_out: string | null;
  work_hours: number | null;
  status: string;
  is_late: boolean;
  late_minutes: number;
  clock_in_photo_url: string | null;
  clock_out_photo_url: string | null;
  notes: string | null;
  shift: { id: string; name: string } | null;
  employee: {
    id: string;
    full_name: string;
    nip: string | null;
    photo_url: string | null;
  } | null;
}

export interface AttendanceListResponse {
  data: AttendanceListRow[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

// ── Statistik bulan & kalender ──────────────────────────────────────────
export interface AttendanceMonthStats {
  month_records: number;
  month_late: number;
  month_off_schedule: number;
  avg_work_hours: number | null;
}

export interface CalendarAttendance {
  id: string;
  date: string;
  clock_in: string | null;
  clock_out: string | null;
  work_hours: number | null;
  status: string;
  is_late: boolean;
}

/** Baris pola jadwal + detail shift dari /api/hris/attendance/schedule. */
export interface CalendarScheduleRow {
  day_of_week: number;
  shift_id: string | null;
  effective_from: string;
  effective_to: string | null;
  shift_name: string | null;
  start_time: string | null; // "HH:MM:SS"
  end_time: string | null;
  is_overnight: boolean | null;
}
