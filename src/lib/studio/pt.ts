/**
 * Logika murni Personal Training (EPIC-055): slot kosong coach.
 * Jam dalam menit sejak tengah malam; string "HH:MM" di batas luar.
 */

import { isoWeekday, timesOverlap, toMinutes } from "./schedule";

export const PT_SLOT_STEP_MINUTES = 30;

export interface Interval {
  start_time: string;
  end_time: string;
}

export function fromMinutes(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/**
 * Slot mulai yang tersedia: setiap kelipatan `step` di dalam jendela
 * ketersediaan yang muat `duration` menit dan tidak bertabrakan dengan jadwal
 * coach (kelas maupun PT lain). `notBefore` (menit) memotong slot yang sudah
 * lewat untuk hari ini.
 */
export function computeFreeSlots(opts: {
  windows: Interval[];
  busy: Interval[];
  durationMinutes: number;
  stepMinutes?: number;
  notBefore?: number | null;
}): string[] {
  const step = opts.stepMinutes ?? PT_SLOT_STEP_MINUTES;
  const out = new Set<string>();
  for (const w of opts.windows) {
    const ws = toMinutes(w.start_time);
    const we = toMinutes(w.end_time);
    // Mulai di kelipatan step pertama di dalam jendela.
    for (let s = Math.ceil(ws / step) * step; s + opts.durationMinutes <= we; s += step) {
      if (opts.notBefore != null && s < opts.notBefore) continue;
      const start = fromMinutes(s);
      const end = fromMinutes(s + opts.durationMinutes);
      if (opts.busy.some((b) => timesOverlap(start, end, b.start_time, b.end_time))) continue;
      out.add(start);
    }
  }
  return [...out].sort();
}

/** Jendela ketersediaan yang berlaku di tanggal tertentu (hari ISO). */
export function windowsForDate<T extends Interval & { weekday: number; is_active: boolean }>(rows: T[], date: string): T[] {
  const wd = isoWeekday(date);
  return rows.filter((r) => r.is_active && r.weekday === wd);
}

/** Apakah tanggal jatuh di rentang cuti coach. */
export function isOnTimeOff(timeOff: { date_from: string; date_to: string }[], date: string): boolean {
  return timeOff.some((t) => t.date_from <= date && t.date_to >= date);
}
