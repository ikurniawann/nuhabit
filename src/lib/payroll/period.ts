/**
 * Logika murni periode payroll (EPIC-008 Fase B):
 * - hari kerja terjadwal dari pola shift (employee_shifts),
 * - klaim hari cuti di-clamp ke periode,
 * - realisasi jam lembur dari pengajuan approved yang dicocokkan absensi,
 * - statistik keterlambatan dari baris absensi.
 *
 * Tanpa akses DB: mudah diuji unit. Pemuatan data ada di inputs.ts.
 */

import {
  resolveShiftForDate,
  type EmployeeShiftRow,
} from "@/lib/hris/shifts";
import { indexHolidays, isHoliday, type HolidayIndex } from "@/lib/hris/holidays";

export interface AttendancePeriodRow {
  date: string; // YYYY-MM-DD
  status: string;
  clock_out: string | null;
  is_late: boolean | null;
  late_minutes: number | null;
  overtime_hours: number | null;
}

export interface OvertimeRequestRow {
  date: string; // YYYY-MM-DD
  hours: number;
}

export interface LeaveRangeRow {
  start_date: string;
  end_date: string;
}

/**
 * Normalisasi nilai kolom `date` Postgres → "YYYY-MM-DD".
 * Driver pg TIDAK memasang type parser khusus, jadi kolom date top-level
 * kembali sebagai objek Date JS di TENGAH MALAM WAKTU LOKAL server , 
 * jangan pakai toISOString() (geser -1 hari utk timezone timur/WIB);
 * ambil komponen lokal. Nilai string (embed row_to_json) dipotong 10 char.
 */
export function dateColToIso(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

export const MONTH_NAMES_ID = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
] as const;

/** "Januari 2026"; bulan di luar 1–12 tetap aman (pakai Januari). */
export function periodLabelId(month: number | null | undefined, year: number): string {
  return `${MONTH_NAMES_ID[(month ?? 1) - 1] ?? MONTH_NAMES_ID[0]} ${year}`;
}

/** Tanggal pertama dan terakhir satu bulan periode (ISO, inklusif). */
export function periodBounds(month: number, year: number): { start: string; end: string } {
  const mm = String(month).padStart(2, "0");
  const lastDay = new Date(year, month, 0).getDate();
  return { start: `${year}-${mm}-01`, end: `${year}-${mm}-${String(lastDay).padStart(2, "0")}` };
}

/** Tambah n hari ke tanggal ISO (kalender polos, aman lintas bulan). */
export function addDaysIso(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Daftar tanggal ISO inklusif [startIso..endIso]. */
export function eachDateOfPeriod(startIso: string, endIso: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${startIso}T00:00:00Z`);
  const end = new Date(`${endIso}T00:00:00Z`);
  while (cursor.getTime() <= end.getTime()) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

/**
 * Hari kerja terjadwal dalam periode menurut pola shift karyawan.
 * hasSchedule=false bila karyawan tidak punya pola sama sekali yang
 * menyentuh periode: pemanggil WAJIB menangani fallback secara eksplisit.
 */
export function countScheduledDays(
  scheduleRows: EmployeeShiftRow[],
  startIso: string,
  endIso: string
): { scheduledDays: number; hasSchedule: boolean } {
  if (scheduleRows.length === 0) {
    return { scheduledDays: 0, hasSchedule: false };
  }
  let scheduledDays = 0;
  for (const dateIso of eachDateOfPeriod(startIso, endIso)) {
    if (resolveShiftForDate(scheduleRows, dateIso)) scheduledDays += 1;
  }
  return { scheduledDays, hasSchedule: true };
}

/**
 * Jumlah hari sebuah rentang cuti yang jatuh DI DALAM periode (inklusif).
 * Cuti lintas bulan hanya dihitung porsinya di periode berjalan , 
 * sebelumnya seluruh durasi terpotong di bulan pengajuan.
 */
export function clampedLeaveDays(
  leave: LeaveRangeRow,
  startIso: string,
  endIso: string
): number {
  const from = leave.start_date > startIso ? leave.start_date : startIso;
  const to = leave.end_date < endIso ? leave.end_date : endIso;
  if (from > to) return 0;
  const fromMs = new Date(`${from}T00:00:00Z`).getTime();
  const toMs = new Date(`${to}T00:00:00Z`).getTime();
  return Math.round((toMs - fromMs) / 86_400_000) + 1;
}

/**
 * Realisasi jam lembur: hanya pengajuan APPROVED yang terealisasi.
 * - Tidak ada absensi ber-clock_out pada tanggal itu → 0 jam (tidak bekerja).
 * - Absensi punya overtime_hours > 0 → min(pengajuan, aktual).
 * - Absensi ada tapi overtime_hours kosong/0 (belum dihitung sistem lama)
 *   → pakai jam pengajuan.
 */
export function realizedOvertimeHours(
  requests: OvertimeRequestRow[],
  attendanceRows: AttendancePeriodRow[]
): number {
  return splitOvertimeHours(requests, attendanceRows, EMPTY_HOLIDAYS).totalHours;
}

const EMPTY_HOLIDAYS: HolidayIndex = indexHolidays([]);

export interface OvertimeSplit {
  /** Jam lembur pada hari kerja biasa: tarif `overtimeMultiplier`. */
  regularHours: number;
  /** Jam lembur pada hari libur resmi: tarif `overtimeHolidayMultiplier`. */
  holidayHours: number;
  totalHours: number;
}

/**
 * Realisasi jam lembur, dipisah hari kerja vs hari libur resmi
 * (EPIC-036 Fase F). Aturan realisasinya sama persis dengan
 * `realizedOvertimeHours`: yang ditambahkan hanya pemisahan bucket-nya.
 *
 * Ketiga tipe libur (nasional, cuti bersama, perusahaan) sama-sama berarti
 * kantor tutup, jadi ketiganya masuk bucket hari libur. `deducts_leave` murni
 * urusan potongan jatah cuti dan tidak relevan di sini.
 *
 * Index kosong → seluruh jam masuk `regularHours`, sehingga hasil payroll
 * periode tanpa hari libur identik dengan sebelum fase ini.
 */
export function splitOvertimeHours(
  requests: OvertimeRequestRow[],
  attendanceRows: AttendancePeriodRow[],
  holidays: HolidayIndex
): OvertimeSplit {
  const byDate = new Map(attendanceRows.map((row) => [row.date, row]));
  let regular = 0;
  let holiday = 0;

  for (const request of requests) {
    const att = byDate.get(request.date);
    if (!att || !att.clock_out) continue;
    const actual = Number(att.overtime_hours) || 0;
    const hours =
      actual > 0 ? Math.min(Number(request.hours), actual) : Number(request.hours);
    if (isHoliday(holidays, request.date)) holiday += hours;
    else regular += hours;
  }

  const round = (value: number) => Math.round(value * 100) / 100;
  return {
    regularHours: round(regular),
    holidayHours: round(holiday),
    totalHours: round(regular + holiday),
  };
}

/** Statistik keterlambatan dari baris absensi (sumber: absensi v2 shift). */
export function computeLateStats(attendanceRows: AttendancePeriodRow[]): {
  lateDays: number;
  lateMinutes: number;
} {
  let lateDays = 0;
  let lateMinutes = 0;
  for (const row of attendanceRows) {
    const isLate = row.is_late === true || row.status === "late";
    if (!isLate) continue;
    lateDays += 1;
    lateMinutes += Number(row.late_minutes) || 0;
  }
  return { lateDays, lateMinutes };
}

/**
 * Irisan sebuah rentang (mis. masa berlaku kontrak) dengan periode payroll.
 * rangeEnd null = tanpa batas (PKWTT). Return null bila tidak bersinggungan.
 */
export function periodCoverage(
  rangeStart: string,
  rangeEnd: string | null,
  periodStartIso: string,
  periodEndIso: string
): { start: string; end: string } | null {
  const start = rangeStart > periodStartIso ? rangeStart : periodStartIso;
  const end =
    rangeEnd !== null && rangeEnd < periodEndIso ? rangeEnd : periodEndIso;
  if (start > end) return null;
  return { start, end };
}

export interface DateRange {
  start: string;
  end: string;
}

/**
 * Gabungkan rentang-rentang tanggal yang tumpang tindih ATAU bersambungan
 * (end + 1 hari = start berikutnya) menjadi rentang kontinu. Dipakai untuk
 * cakupan kontrak: PKWT yang berakhir tgl 15 lalu diperpanjang mulai tgl 16
 * harus terhitung SATU cakupan penuh: bukan proraté setengah bulan.
 */
export function mergeDateRanges(ranges: DateRange[]): DateRange[] {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => (a.start < b.start ? -1 : 1));
  const merged: DateRange[] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const next = sorted[i];
    if (next.start <= addDaysIso(last.end, 1)) {
      if (next.end > last.end) last.end = next.end;
    } else {
      merged.push({ ...next });
    }
  }
  return merged;
}

/**
 * Jam lembur dari jam mulai/selesai (mendukung lembur lewat tengah malam),
 * dibulatkan 2 desimal. Dipakai API pengajuan lembur.
 */
export function overtimeHoursFromTimes(
  startTime: string,
  endTime: string
): number {
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  let minutes = eh * 60 + (em || 0) - (sh * 60 + (sm || 0));
  if (minutes <= 0) minutes += 24 * 60;
  return Math.round((minutes / 60) * 100) / 100;
}
