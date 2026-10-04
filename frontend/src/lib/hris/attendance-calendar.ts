/**
 * Logika kalender & rekap absensi (tanpa React): kunci tanggal WIB, rentang
 * bulan, grid kalender, dan status jadwal per tanggal.
 */
import { resolveScheduleRowForDate, type EmployeeShiftRow } from "./shifts";

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Kunci tanggal WIB (YYYY-MM-DD). Kolom `date` Postgres di-serialize server
 * (TZ WIB) menjadi ISO UTC bergeser 17:00 hari sebelumnya; normalisasi di
 * zona Asia/Jakarta mengembalikannya ke tanggal kalender yang benar.
 */
export function wibDateKey(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
}

/** YYYY-MM-DD dari komponen tanggal kalender (monthIndex 0-based). */
export function dateKey(year: number, monthIndex: number, day: number): string {
  return `${year}-${pad(monthIndex + 1)}-${pad(day)}`;
}

/** "08:00:00" → "08.00"; kosong untuk null. */
export function shiftClock(time: string | null): string {
  return time ? time.slice(0, 5).replace(":", ".") : "";
}

/** Rentang satu bulan penuh (monthIndex 0-based). */
export function monthBounds(year: number, monthIndex: number): { start: string; end: string } {
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return { start: dateKey(year, monthIndex, 1), end: dateKey(year, monthIndex, lastDay) };
}

/** "YYYY-MM" → rentang tanggal satu bulan penuh. */
export function monthRange(month: string): { start: string; end: string } {
  const [year, mon] = month.split("-").map(Number);
  return monthBounds(year, mon - 1);
}

/** Bulan berjalan di WIB, "YYYY-MM". */
export function currentMonthWib(now = new Date()): string {
  return new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 7);
}

/** Susunan sel kalender: jumlah hari, offset hari pertama (0 = Minggu), total sel. */
export function monthGrid(year: number, monthIndex: number) {
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const firstWeekday = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay();
  const totalCells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
  return { daysInMonth, firstWeekday, totalCells };
}

/**
 * Status jadwal satu tanggal. `scheduled` = baris pola dengan shift; `isDayOff`
 * = ada pola tapi shift_id null (libur terjadwal).
 */
export function resolveDaySchedule<T extends EmployeeShiftRow>(
  schedule: readonly T[],
  dateIso: string
): { scheduled: T | null; isDayOff: boolean } {
  const row = schedule.length > 0 ? resolveScheduleRowForDate([...schedule], dateIso) : null;
  return {
    scheduled: row && row.shift_id ? row : null,
    isDayOff: row !== null && row.shift_id === null,
  };
}

/** Indeks baris absensi per tanggal WIB. */
export function indexByWibDate<T extends { date: string }>(rows: readonly T[]): Record<string, T> {
  const map: Record<string, T> = {};
  for (const row of rows) map[wibDateKey(row.date)] = row;
  return map;
}
