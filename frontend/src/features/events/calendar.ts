/** Aturan murni kalender event: grid bulan, minggu Senin–Minggu, rentang kueri, pengelompokan per hari. */

import { addDays } from "@/lib/dates";
import { localDay, localInstant } from "@/lib/timezone";
import type { CalendarEntry, EntryKind } from "./api";

export type CalendarView = "month" | "week" | "day";

/** "YYYY-MM" dari "YYYY-MM-DD". */
export const monthOf = (day: string) => day.slice(0, 7);

/** Hari pertama bulan "YYYY-MM". */
export const firstDayOf = (month: string) => `${month}-01`;

/** Geser bulan "YYYY-MM" sebanyak n bulan. */
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

/** ISO weekday 1 (Senin) sampai 7 (Minggu) dari "YYYY-MM-DD". */
export function isoWeekday(day: string): number {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
  return dow === 0 ? 7 : dow;
}

/** Senin dari minggu yang memuat hari itu. */
export const weekStart = (day: string) => addDays(day, 1 - isoWeekday(day));

/** Tujuh hari Senin–Minggu dari minggu yang memuat hari itu. */
export const weekDays = (day: string) => Array.from({ length: 7 }, (_, i) => addDays(weekStart(day), i));

/**
 * Grid bulan: baris minggu Senin–Minggu yang menutup seluruh bulan, hari di
 * luar bulan ikut terisi agar setiap baris lengkap.
 */
export function monthGrid(month: string): string[][] {
  const first = firstDayOf(month);
  const lastOfMonth = addDays(firstDayOf(shiftMonth(month, 1)), -1);
  const rows: string[][] = [];
  for (let cursor = weekStart(first); cursor <= lastOfMonth; cursor = addDays(cursor, 7)) {
    rows.push(Array.from({ length: 7 }, (_, i) => addDays(cursor, i)));
  }
  return rows;
}

/** Hari yang ditampilkan sebuah tampilan: grid bulan, satu minggu, atau satu hari. */
export function visibleDays(view: CalendarView, anchor: string): string[] {
  if (view === "month") return monthGrid(monthOf(anchor)).flat();
  if (view === "week") return weekDays(anchor);
  return [anchor];
}

/** Rentang kueri [from, to) dalam zona WIB yang menutup hari yang tampil. */
export function queryRange(view: CalendarView, anchor: string): { from: string; to: string } {
  const days = visibleDays(view, anchor);
  return { from: localInstant(days[0], "00:00").toISOString(), to: localInstant(addDays(days[days.length - 1], 1), "00:00").toISOString() };
}

/** Geser jangkar sesuai tampilan: sebulan, seminggu, atau sehari. */
export function shiftAnchor(view: CalendarView, anchor: string, n: number): string {
  if (view === "month") return firstDayOf(shiftMonth(monthOf(anchor), n));
  return addDays(anchor, view === "week" ? 7 * n : n);
}

/** Entri per hari (zona cabang entri), tiap hari urut jam mulai. */
export function groupByDay(entries: readonly CalendarEntry[]): Map<string, CalendarEntry[]> {
  const out = new Map<string, CalendarEntry[]>();
  const sorted = [...entries].sort((a, b) => a.starts_at.localeCompare(b.starts_at) || a.title.localeCompare(b.title));
  for (const e of sorted) {
    const day = localDay(e.starts_at, e.timezone);
    const list = out.get(day);
    if (list) list.push(e);
    else out.set(day, [e]);
  }
  return out;
}

const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const WEEKDAYS_LONG = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"];
export const WEEKDAYS_SHORT = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];

/** "November 2026". */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

/** "Senin, 2 November 2026". */
export function dayLabel(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return `${WEEKDAYS_LONG[isoWeekday(day) - 1]}, ${d} ${MONTHS[m - 1]} ${y}`;
}

/** "Sen, 2 Nov" for the week columns. */
export function shortDayLabel(day: string): string {
  const [, m, d] = day.split("-").map(Number);
  return `${WEEKDAYS_SHORT[isoWeekday(day) - 1]}, ${d} ${MONTHS[m - 1].slice(0, 3)}`;
}

/** "2–8 November 2026" atau "30 November – 6 Desember 2026" untuk seminggu. */
export function weekLabel(day: string): string {
  const days = weekDays(day);
  const [y1, m1, d1] = days[0].split("-").map(Number);
  const [y2, m2, d2] = days[6].split("-").map(Number);
  if (m1 === m2) return `${d1}–${d2} ${MONTHS[m1 - 1]} ${y1}`;
  if (y1 === y2) return `${d1} ${MONTHS[m1 - 1]} – ${d2} ${MONTHS[m2 - 1]} ${y1}`;
  return `${d1} ${MONTHS[m1 - 1]} ${y1} – ${d2} ${MONTHS[m2 - 1]} ${y2}`;
}

/** Warna batang per jenis entri; brand lime hanya sebagai isian dengan teks forest. */
export const KIND_TONE: Record<EntryKind, { bar: string; chip: string }> = {
  crm_event: { bar: "bg-forest", chip: "bg-accent-strong text-accent-foreground" },
  site_event: { bar: "bg-info", chip: "bg-info-soft text-info" },
  class: { bar: "bg-ink", chip: "bg-surface text-body" },
  pt: { bar: "bg-warning", chip: "bg-warning-soft text-warning" },
};

/** Jalur halaman sumber sebuah entri. */
export function entryHref(e: CalendarEntry): string {
  switch (e.kind) {
    case "crm_event":
      return "/dashboard/crm/events";
    case "site_event":
      return "/dashboard/site/events";
    case "class":
      return `/dashboard/gym/sessions/${e.id}`;
    default:
      return "/dashboard/gym/pt";
  }
}
