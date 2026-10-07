"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchHolidayIndex } from "@/lib/hris/holidays-client";
import { attendanceQueryKeys } from "./query-keys";
import {
  fetchActiveEmployees,
  fetchAttendanceList,
  fetchAttendanceMonthStats,
  fetchCalendarAttendances,
  fetchDailyRoster,
  fetchEmployeeSchedule,
} from "./api";
import type { AttendanceListParams } from "./types";

export const useActiveEmployees = () =>
  useQuery({ queryKey: attendanceQueryKeys.employees(), queryFn: fetchActiveEmployees });

export const useAttendanceList = (params: AttendanceListParams) =>
  useQuery({
    queryKey: attendanceQueryKeys.list(params),
    queryFn: () => fetchAttendanceList(params),
  });

/** month = "YYYY-MM". */
export const useAttendanceMonthStats = (month: string) =>
  useQuery({
    queryKey: attendanceQueryKeys.monthStats(month),
    queryFn: () => {
      const [year, mon] = month.split("-").map(Number);
      return fetchAttendanceMonthStats(year, mon);
    },
  });

export const useDailyRoster = (date: string) =>
  useQuery({ queryKey: attendanceQueryKeys.roster(date), queryFn: () => fetchDailyRoster(date) });

export const useCalendarAttendances = (
  employeeId: string | undefined,
  start: string,
  end: string
) =>
  useQuery({
    queryKey: attendanceQueryKeys.calendar(employeeId, start, end),
    queryFn: () => fetchCalendarAttendances({ start_date: start, end_date: end, employee_id: employeeId }),
  });

export const useEmployeeSchedule = (employeeId: string | undefined) =>
  useQuery({
    queryKey: attendanceQueryKeys.schedule(employeeId ?? ""),
    queryFn: () => fetchEmployeeSchedule(employeeId ?? ""),
    enabled: !!employeeId,
  });

/** Hari libur rentang tampak; fetchHolidayIndex tidak pernah melempar. */
export const useHolidayIndex = (start: string, end: string, enabled = true) =>
  useQuery({
    queryKey: attendanceQueryKeys.holidays(start, end),
    queryFn: () => fetchHolidayIndex(start, end),
    enabled,
  });
