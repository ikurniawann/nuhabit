/**
 * EPIC-050 Fase 1 (T-1.5) — helper murni kalender (tanpa dependensi UI).
 * Semua tanggal dihitung dalam zona lokal browser; kunci hari = YYYY-MM-DD.
 */

export type CalendarMode = "month" | "week" | "day";

export function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date: Date, days: number): Date {
  const d = startOfDay(date);
  d.setDate(d.getDate() + days);
  return d;
}

/** Senin sebagai awal minggu (kebiasaan Indonesia). */
export function startOfWeek(date: Date): Date {
  const d = startOfDay(date);
  const dow = (d.getDay() + 6) % 7; // Senin=0 … Minggu=6
  d.setDate(d.getDate() - dow);
  return d;
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

/** Rentang tanggal yang perlu diambil dari API untuk satu tampilan. */
export function visibleRange(anchor: Date, mode: CalendarMode): { from: Date; to: Date } {
  if (mode === "day") {
    const d = startOfDay(anchor);
    return { from: d, to: d };
  }
  if (mode === "week") {
    const from = startOfWeek(anchor);
    return { from, to: addDays(from, 6) };
  }
  // month: grid 6 minggu penuh mulai Senin sebelum tanggal 1
  const from = startOfWeek(startOfMonth(anchor));
  const lastCell = addDays(from, 41);
  const end = endOfMonth(anchor);
  return { from, to: lastCell > end ? lastCell : end };
}

/** 42 sel (6×7) untuk grid bulan; `inMonth` menandai tanggal di bulan anchor. */
export function monthGrid(anchor: Date): Array<{ date: Date; key: string; inMonth: boolean }> {
  const from = startOfWeek(startOfMonth(anchor));
  const month = anchor.getMonth();
  return Array.from({ length: 42 }, (_, i) => {
    const date = addDays(from, i);
    return { date, key: dayKey(date), inMonth: date.getMonth() === month };
  });
}

/** 7 hari Senin–Minggu untuk tampilan minggu. */
export function weekDays(anchor: Date): Array<{ date: Date; key: string }> {
  const from = startOfWeek(anchor);
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(from, i);
    return { date, key: dayKey(date) };
  });
}

export function shiftAnchor(anchor: Date, mode: CalendarMode, direction: -1 | 1): Date {
  if (mode === "day") return addDays(anchor, direction);
  if (mode === "week") return addDays(anchor, 7 * direction);
  return new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1);
}

/** Kelompokkan item ber-`due_at` ke kunci hari lokal; tanpa due → dibuang. */
export function bucketByDay<T extends { due_at: string | null }>(items: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    if (!item.due_at) continue;
    const t = Date.parse(item.due_at);
    if (Number.isNaN(t)) continue;
    const key = dayKey(new Date(t));
    const list = map.get(key) ?? [];
    list.push(item);
    map.set(key, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => Date.parse(a.due_at as string) - Date.parse(b.due_at as string));
  }
  return map;
}

export function formatRangeLabel(anchor: Date, mode: CalendarMode): string {
  const opts: Intl.DateTimeFormatOptions =
    mode === "month"
      ? { month: "long", year: "numeric" }
      : mode === "day"
        ? { weekday: "long", day: "numeric", month: "long", year: "numeric" }
        : { day: "numeric", month: "short" };
  if (mode === "week") {
    const { from, to } = visibleRange(anchor, "week");
    return `${from.toLocaleDateString("id-ID", opts)} – ${to.toLocaleDateString("id-ID", { ...opts, year: "numeric" })}`;
  }
  return anchor.toLocaleDateString("id-ID", opts);
}
