import type { AttendanceListParams } from "./types";

export const attendanceQueryKeys = {
  all: ["hris", "attendance"] as const,
  employees: () => ["hris", "attendance", "employees"] as const,
  list: (params: AttendanceListParams) => ["hris", "attendance", "list", params] as const,
  monthStats: (month: string) => ["hris", "attendance", "month-stats", month] as const,
  roster: (date: string) => ["hris", "attendance", "roster", date] as const,
  calendarAll: () => ["hris", "attendance", "calendar"] as const,
  calendar: (employeeId: string | undefined, start: string, end: string) =>
    ["hris", "attendance", "calendar", employeeId ?? "", start, end] as const,
  schedule: (employeeId: string) => ["hris", "attendance", "schedule", employeeId] as const,
  holidays: (start: string, end: string) => ["hris", "holiday-index", start, end] as const,
};
