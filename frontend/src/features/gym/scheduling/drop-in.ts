import type { Session } from "./api";

/** Walk-in boleh masuk sesi yang mulai paling lambat satu jam lagi. */
export const DROP_IN_LEAD_MS = 3_600_000;

/** Sesi untuk drop-in: terbit atau penuh, belum selesai, dan sudah berjalan atau mulai dalam satu jam. */
export function dropInSessions(sessions: Session[], now: number): Session[] {
  return sessions.filter(
    (s) =>
      (s.status === "published" || s.status === "full") &&
      Date.parse(s.ends_at) > now &&
      Date.parse(s.starts_at) - DROP_IN_LEAD_MS <= now
  );
}
