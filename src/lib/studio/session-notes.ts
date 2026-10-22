/**
 * Catatan coach setelah sesi (EPIC-067 T-067-C4). Logika murni — query di
 * session-notes-server.ts.
 */

export const SESSION_NOTE_MAX = 500;
/** Coach boleh menulis catatan untuk sesi hari ini atau paling lama 7 hari lalu. */
export const NOTE_WRITE_WINDOW_DAYS = 7;
/** Riwayat catatan (yang tidak dibawa) yang ikut tampil di roster. */
export const NOTE_HISTORY_DAYS = 60;
export const NOTE_HISTORY_LIMIT = 3;

export interface SessionNote {
  id: string;
  customer_id: string;
  body: string;
  carry_forward: boolean;
  /** Masih dibawa ke sesi berikutnya (carry_forward & belum dilepas). */
  pinned: boolean;
  coach_id: string;
  coach_name: string;
  session_label: string | null;
  session_date: string | null;
  created_at: string;
}

const dayNumber = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;

/** Boleh menulis catatan untuk sesi bertanggal ini (WIB): hari ini s/d 7 hari lalu — bukan sesi mendatang. */
export function canWriteNote(sessionDate: string, today: string): boolean {
  const diff = dayNumber(today) - dayNumber(sessionDate);
  return diff >= 0 && diff <= NOTE_WRITE_WINDOW_DAYS;
}

/** Yang tampil di roster per member: semua catatan yang dibawa (terbaru dulu), lalu riwayat terbaru maks N. */
export function notesForRoster<T extends Pick<SessionNote, "pinned" | "created_at">>(notes: T[], historyLimit = NOTE_HISTORY_LIMIT): T[] {
  // pg mengembalikan timestamptz sebagai Date — bandingkan sebagai waktu, bukan string.
  const byNewest = [...notes].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return [...byNewest.filter((n) => n.pinned), ...byNewest.filter((n) => !n.pinned).slice(0, historyLimit)];
}
