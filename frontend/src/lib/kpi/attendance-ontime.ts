import {
  resolveShiftForDate,
  type EmployeeShiftRow,
} from "@/lib/hris/shifts";
import { eachDateOfPeriod } from "@/lib/payroll/period";
import { safeRatio } from "./collect-math";

/**
 * Kalkulasi indikator att_ontime (EPIC-010) utk SATU karyawan — murni.
 * Basis: hari terjadwal shift (reuse resolver `lib/hris/shifts`, ISO dow 1-7)
 * dikurangi cuti approved; tanpa jadwal → fallback basis hari hadir
 * (konsisten keputusan payroll/absensi v2).
 */

export interface OntimeAttendanceRow {
  date: string; // YYYY-MM-DD
  is_late: boolean | null;
}

export interface OntimeInput {
  scheduleRows: EmployeeShiftRow[];
  /** Baris absensi status present dalam periode */
  attendanceRows: OntimeAttendanceRow[];
  /** Tanggal ISO cuti approved dalam periode */
  leaveDays: Set<string>;
  startIso: string;
  endIso: string;
}

export interface OntimeResult {
  /** on-time / basis; null bila basis 0 (dikeluarkan dari skor) */
  actual: number | null;
  /** jumlah hari basis (utk aturan minimum data) */
  sampleSize: number;
  detail: {
    basis: "shift_schedule" | "attendance";
    scheduledDays: number;
    leaveDays: number;
    presentDays: number;
    ontimeDays: number;
  };
}

export function computeOntime(input: OntimeInput): OntimeResult {
  const byDate = new Map(
    input.attendanceRows.map((row) => [row.date, row] as const)
  );
  const hasSchedule = input.scheduleRows.length > 0;

  let scheduledDays = 0;
  let leaveDays = 0;
  let ontimeScheduled = 0;

  if (hasSchedule) {
    for (const dateIso of eachDateOfPeriod(input.startIso, input.endIso)) {
      if (!resolveShiftForDate(input.scheduleRows, dateIso)) continue;
      if (input.leaveDays.has(dateIso)) {
        leaveDays += 1;
        continue;
      }
      scheduledDays += 1;
      const attendance = byDate.get(dateIso);
      if (attendance && attendance.is_late !== true) ontimeScheduled += 1;
    }
  }

  const presentDays = input.attendanceRows.length;
  const ontimePresent = input.attendanceRows.filter(
    (row) => row.is_late !== true
  ).length;

  const basis = hasSchedule ? "shift_schedule" : "attendance";
  const denominator = hasSchedule ? scheduledDays : presentDays;
  const numerator = hasSchedule ? ontimeScheduled : ontimePresent;

  return {
    actual: safeRatio(numerator, denominator),
    sampleSize: denominator,
    detail: {
      basis,
      scheduledDays,
      leaveDays,
      presentDays,
      ontimeDays: numerator,
    },
  };
}
