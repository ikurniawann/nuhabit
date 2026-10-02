/**
 * Logika murni tampilan Kalender Kelas (monitoring) — tata letak event yang
 * bertumpuk, grid bulan, dan rentang jam. Tanpa DOM/DB supaya mudah diuji.
 */

import { addDays, startOfWeek, toMinutes } from "./schedule";

export interface TimedItem {
  id: string;
  start_time: string;
  end_time: string;
}

export interface LaidOut<T> {
  item: T;
  /** Lajur ke berapa (0-based) di dalam kelompok yang saling bertumpuk. */
  lane: number;
  /** Jumlah lajur kelompoknya — lebar event = 1 / lanes. */
  lanes: number;
}

/**
 * Susun event satu hari: event yang jamnya bertumpuk ditaruh berdampingan.
 * Kelompok = rangkaian event yang saling tersambung tumpang tindih; lebar
 * lajur dihitung per kelompok supaya event yang tidak bertabrakan tetap lebar penuh.
 */
export function layoutOverlaps<T extends TimedItem>(items: T[]): LaidOut<T>[] {
  const sorted = [...items].sort(
    (a, b) => toMinutes(a.start_time) - toMinutes(b.start_time) || toMinutes(b.end_time) - toMinutes(a.end_time)
  );
  const out: LaidOut<T>[] = [];
  let group: LaidOut<T>[] = [];
  let laneEnds: number[] = [];
  let groupEnd = -1;

  const flush = () => {
    const lanes = Math.max(laneEnds.length, 1);
    for (const g of group) g.lanes = lanes;
    out.push(...group);
    group = [];
    laneEnds = [];
  };

  for (const item of sorted) {
    const start = toMinutes(item.start_time);
    const end = toMinutes(item.end_time);
    if (group.length > 0 && start >= groupEnd) flush();
    let lane = laneEnds.findIndex((e) => e <= start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(end);
    } else {
      laneEnds[lane] = end;
    }
    group.push({ item, lane, lanes: 1 });
    groupEnd = Math.max(groupEnd, end);
  }
  if (group.length) flush();
  return out;
}

/** 6 minggu × 7 hari untuk tampilan bulan, mulai Senin sebelum/tanggal 1. */
export function monthGrid(anyDateInMonth: string): string[] {
  const first = `${anyDateInMonth.slice(0, 7)}-01`;
  const start = startOfWeek(first);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export function monthBounds(anyDateInMonth: string): { from: string; to: string } {
  const grid = monthGrid(anyDateInMonth);
  return { from: grid[0], to: grid[41] };
}

/** Tanggal 1 bulan berikut/sebelumnya. */
export function shiftMonth(date: string, delta: number): string {
  const [y, m] = date.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 10);
}

/**
 * Rentang jam grid: dari jam kelas paling pagi sampai paling malam (dibulatkan),
 * dengan default 06:00–21:00 supaya grid kosong tetap terbaca.
 */
export function hourRange(items: TimedItem[], fallback: [number, number] = [6, 21]): [number, number] {
  if (items.length === 0) return fallback;
  const minStart = Math.min(...items.map((i) => toMinutes(i.start_time)));
  const maxEnd = Math.max(...items.map((i) => toMinutes(i.end_time)));
  const from = Math.min(Math.floor(minStart / 60), fallback[0]);
  const to = Math.max(Math.ceil(maxEnd / 60), fallback[1]);
  return [Math.max(from, 0), Math.min(to, 24)];
}

/** Durasi menit total per coach (beban mengajar), sesi batal tidak dihitung. */
export function coachLoad(
  items: (TimedItem & { coach_id: string | null; coach_name: string | null; status: string })[]
): { coach_id: string | null; coach_name: string; minutes: number; sessions: number }[] {
  const map = new Map<string, { coach_id: string | null; coach_name: string; minutes: number; sessions: number }>();
  for (const s of items) {
    if (s.status === "cancelled") continue;
    const key = s.coach_id ?? "__none__";
    const row = map.get(key) ?? { coach_id: s.coach_id, coach_name: s.coach_name ?? "Tanpa coach", minutes: 0, sessions: 0 };
    row.minutes += toMinutes(s.end_time) - toMinutes(s.start_time);
    row.sessions += 1;
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => (a.coach_id === null ? 1 : b.coach_id === null ? -1 : b.minutes - a.minutes));
}

export type AxisSegment = { kind: "hours" | "gap"; from: number; to: number };

/**
 * Sumbu waktu yang menciutkan jam kosong: jam berisi kelas tampil penuh, celah
 * ≥ `minGapHours` tanpa kelas diganti satu pita tipis. Satuan jam (integer).
 * Pola Nuhabit (pagi 06–09, sore 17–20) jadi muat satu layar tanpa ruang mati.
 */
export function buildTimeAxis(items: TimedItem[], fallback: [number, number] = [6, 21], minGapHours = 2): AxisSegment[] {
  if (items.length === 0) return [{ kind: "hours", from: fallback[0], to: fallback[1] }];
  const [from, to] = hourRange(items, [24, 0]);
  const busy = new Array(24).fill(false);
  for (const i of items) {
    const s = Math.floor(toMinutes(i.start_time) / 60);
    const e = Math.ceil(toMinutes(i.end_time) / 60);
    for (let h = s; h < e; h++) busy[h] = true;
  }
  const segments: AxisSegment[] = [];
  let h = from;
  while (h < to) {
    const isBusy = busy[h];
    let end = h;
    while (end < to && busy[end] === isBusy) end++;
    const kind = !isBusy && end - h >= minGapHours ? "gap" : "hours";
    const last = segments[segments.length - 1];
    if (last && last.kind === kind && kind === "hours") last.to = end;
    else segments.push({ kind, from: h, to: end });
    h = end;
  }
  return segments;
}

/** Posisi piksel untuk menit tertentu pada sumbu bersegmen. */
export function axisOffset(segments: AxisSegment[], minutes: number, hourPx: number, gapPx: number): number {
  let y = 0;
  for (const seg of segments) {
    const size = seg.kind === "gap" ? gapPx : (seg.to - seg.from) * hourPx;
    if (minutes <= seg.from * 60) return y;
    if (seg.kind === "gap" && minutes < seg.to * 60) return y + gapPx / 2;
    if (seg.kind === "hours" && minutes <= seg.to * 60) return y + ((minutes - seg.from * 60) / 60) * hourPx;
    y += size;
  }
  return y;
}

export function axisHeight(segments: AxisSegment[], hourPx: number, gapPx: number): number {
  return segments.reduce((sum, s) => sum + (s.kind === "gap" ? gapPx : (s.to - s.from) * hourPx), 0);
}
