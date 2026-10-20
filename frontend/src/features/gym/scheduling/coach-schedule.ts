import { wibDay, type Session } from "./api";

export interface DayGroup<T> {
  /** Hari WIB, "YYYY-MM-DD". */
  day: string;
  sessions: T[];
}

/** Kelompokkan sesi per hari WIB, urut waktu mulai. */
export function sessionsByDay<T extends Pick<Session, "starts_at">>(sessions: readonly T[]): DayGroup<T>[] {
  const groups = new Map<string, T[]>();
  for (const session of [...sessions].sort((a, b) => a.starts_at.localeCompare(b.starts_at))) {
    const day = wibDay(session.starts_at);
    groups.set(day, [...(groups.get(day) ?? []), session]);
  }
  return [...groups].map(([day, rows]) => ({ day, sessions: rows }));
}

/** Kursi terisi: booking yang memegang kursi ditambah no-show. */
export const bookedSeats = (s: Pick<Session, "confirmed_count" | "no_show_count">) => s.confirmed_count + s.no_show_count;

/** 0,734 → "73%"; null → "—". */
export const fillLabel = (ratio: number | null) => (ratio === null ? "—" : `${Math.round(ratio * 100)}%`);
