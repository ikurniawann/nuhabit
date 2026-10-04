import { apiGet, buildListUrl } from "@/lib/api-client";
import type {
  AttendanceExportParams,
  AttendanceListParams,
  AttendanceListResponse,
  AttendanceMonthStats,
  CalendarAttendance,
  CalendarScheduleRow,
  DailyRosterData,
} from "./types";

export type AttendanceExportFormat = "csv" | "xlsx" | "pdf";

export async function exportAttendanceCsv(
  params: AttendanceExportParams,
  format: AttendanceExportFormat = "csv"
): Promise<Blob> {
  const search = new URLSearchParams();
  if (params.employee_id && params.employee_id !== "all") {
    search.set("employee_id", params.employee_id);
  }
  if (params.status && params.status !== "all") {
    search.set("status", params.status);
  }
  if (params.start_date) search.set("start_date", params.start_date);
  if (params.end_date) search.set("end_date", params.end_date);
  if (format !== "csv") search.set("format", format);

  const response = await fetch(`/api/hris/attendance/export?${search.toString()}`);
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "Export failed");
  }
  return response.blob();
}

export const fetchDailyRoster = (date?: string) =>
  apiGet<{ data: DailyRosterData }>(
    buildListUrl("/api/hris/attendance/daily-roster", { date })
  ).then((res) => res.data);

export const fetchAttendanceList = (params: AttendanceListParams) =>
  apiGet<AttendanceListResponse>(
    buildListUrl("/api/hris/attendance", {
      employee_id: params.employee_id,
      start_date: params.start_date,
      end_date: params.end_date,
      is_late: params.is_late ? "true" : undefined,
      page: params.page ?? 1,
      limit: params.limit ?? 20,
    })
  );

export interface EmployeeOption {
  id: string;
  full_name: string;
  nip?: string | null;
}

export const fetchActiveEmployees = () =>
  apiGet<{ data?: EmployeeOption[] }>(
    "/api/hris/employees?is_active=true&limit=500&sort_by=full_name&sort_order=asc"
  ).then((res) => res.data ?? []);

/** Statistik bulan (year + month 1-12); null bila endpoint gagal. */
export function fetchAttendanceMonthStats(year: number, month: number) {
  return apiGet<{ data: AttendanceMonthStats | null }>(
    `/api/hris/attendance/stats?month=${month}&year=${year}`
  )
    .then((res) => res.data ?? null)
    .catch(() => null);
}

/** Absensi satu rentang untuk kalender ("me" = karyawan yang login). */
export function fetchCalendarAttendances(params: {
  start_date: string;
  end_date: string;
  employee_id?: string;
}) {
  return apiGet<{ data?: CalendarAttendance[] }>(
    buildListUrl("/api/hris/attendance", { ...params, limit: 100 })
  ).then((res) => res.data ?? []);
}

/** Pola jadwal shift karyawan; kosong bila gagal (kalender tetap tampil). */
export function fetchEmployeeSchedule(employeeId: string) {
  return apiGet<{ data?: CalendarScheduleRow[] }>(
    buildListUrl("/api/hris/attendance/schedule", { employee_id: employeeId })
  )
    .then((res) => res.data ?? [])
    .catch(() => [] as CalendarScheduleRow[]);
}
