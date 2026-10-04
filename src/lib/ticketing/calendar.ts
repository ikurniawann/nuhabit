// Aritmetika tanggal kalender "YYYY-MM-DD" (UTC murni, tanpa jam) untuk
// rentang laporan/okupansi/kalender ticket. Fungsi murni.

import { isValidCalendarDate } from "./pricing";

export function addDaysIso(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function daysBetweenIso(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000
  );
}

/** Pesan galat rentang [from..to] (null = valid): tanggal sah, urut, ≤ maxDays. */
export function dateRangeError(from: string, to: string, maxDays: number): string | null {
  if (!isValidCalendarDate(from) || !isValidCalendarDate(to) || to < from) {
    return "Rentang tanggal tidak valid";
  }
  if (daysBetweenIso(from, to) > maxDays) return `Rentang maksimum ${maxDays} hari`;
  return null;
}

/** Semua tanggal dalam [from..to] inklusif. */
export function eachDayIso(from: string, to: string): string[] {
  const days: string[] = [];
  for (let d = from; d <= to; d = addDaysIso(d, 1)) days.push(d);
  return days;
}
