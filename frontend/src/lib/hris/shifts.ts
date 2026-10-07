/**
 * Logika murni jadwal shift karyawan — dipakai clock-in (hitung
 * keterlambatan) dan tampilan "shift hari ini" di ESS.
 *
 * Konvensi:
 * - day_of_week: 1 = Senin … 7 = Minggu (ISO), mengikuti getUTCDay() yang
 *   dinormalisasi (0/Minggu → 7).
 * - Jam shift dalam waktu lokal WIB (Asia/Jakarta, UTC+7) — konsisten dengan
 *   operasional outlet; tanggal absen = tanggal mulai shift.
 */

export const WIB_OFFSET_HOURS = 7;

export interface ShiftInfo {
  id: string;
  name: string;
  start_time: string; // "HH:MM:SS"
  end_time: string;
  late_tolerance_minutes: number;
  is_overnight: boolean;
}

export interface EmployeeShiftRow {
  day_of_week: number; // 1=Senin … 7=Minggu
  shift_id: string | null; // null = libur
  effective_from: string; // YYYY-MM-DD
  effective_to: string | null;
}

/** 1=Senin … 7=Minggu untuk tanggal ISO (dianggap tanggal kalender polos). */
export function isoDayOfWeek(dateIso: string): number {
  const day = new Date(`${dateIso}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

/**
 * Cari baris pola yang berlaku untuk sebuah tanggal: hari cocok, rentang
 * efektif mencakup tanggal, dan pola terbaru (effective_from terbesar)
 * menang. Return baris pemenang APA ADANYA — termasuk baris libur
 * (shift_id null) — atau null bila tidak ada pola sama sekali. Dipakai
 * tampilan jadwal yang perlu membedakan "libur" vs "tanpa jadwal".
 */
export function resolveScheduleRowForDate<T extends EmployeeShiftRow>(
  rows: T[],
  dateIso: string
): T | null {
  const dow = isoDayOfWeek(dateIso);
  const candidates = rows
    .filter(
      (row) =>
        row.day_of_week === dow &&
        row.effective_from <= dateIso &&
        (row.effective_to === null || row.effective_to >= dateIso)
    )
    .sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1));

  return candidates[0] ?? null;
}

/**
 * Seperti resolveScheduleRowForDate, tapi hanya mengembalikan baris ber-shift
 * (libur/tanpa jadwal → null). Dipakai perhitungan keterlambatan clock-in.
 */
export function resolveShiftForDate(
  rows: EmployeeShiftRow[],
  dateIso: string
): EmployeeShiftRow | null {
  const winner = resolveScheduleRowForDate(rows, dateIso);
  if (!winner || winner.shift_id === null) return null;
  return winner;
}

function wibDateTime(dateIso: string, time: string, addDays = 0): Date {
  const [hour, minute, second] = time.split(":").map(Number);
  const base = new Date(`${dateIso}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + addDays);
  base.setUTCHours(hour - WIB_OFFSET_HOURS, minute ?? 0, second ?? 0, 0);
  return base;
}

/** Jendela kerja terjadwal (UTC) untuk shift pada suatu tanggal mulai. */
export function scheduledWindow(
  dateIso: string,
  shift: Pick<ShiftInfo, "start_time" | "end_time" | "is_overnight">
): { start: Date; end: Date } {
  return {
    start: wibDateTime(dateIso, shift.start_time),
    end: wibDateTime(dateIso, shift.end_time, shift.is_overnight ? 1 : 0),
  };
}

/**
 * Keterlambatan clock-in terhadap shift: melewati (jam mulai + toleransi)
 * dihitung terlambat, dengan late_minutes dari jam mulai shift (bukan dari
 * batas toleransi) — konvensi umum HR Indonesia.
 */
export function computeLateness(
  clockIn: Date,
  dateIso: string,
  shift: Pick<ShiftInfo, "start_time" | "end_time" | "is_overnight" | "late_tolerance_minutes">
): { is_late: boolean; late_minutes: number } {
  const { start } = scheduledWindow(dateIso, shift);
  const graceMs = shift.late_tolerance_minutes * 60_000;
  if (clockIn.getTime() <= start.getTime() + graceMs) {
    return { is_late: false, late_minutes: 0 };
  }
  const lateMinutes = Math.ceil((clockIn.getTime() - start.getTime()) / 60_000);
  return { is_late: true, late_minutes: lateMinutes };
}
