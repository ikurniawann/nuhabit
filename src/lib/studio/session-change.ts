/**
 * Kabar ke member saat coach diganti / kelas dibatalkan (EPIC-067 T-067-A6).
 * Logika murni — query di session-change-server.ts. Pesan berbahasa Inggris,
 * seragam dengan pengingat lain dan Member App (keputusan owner 2026-10-02).
 */

import { englishDate, firstName, inSendWindow, QUIET_END_HOUR, wibNow } from "@/lib/studio/jobs";

export type SessionChangeKind = "coach_changed" | "cancelled" | "rescheduled";

export const DEFAULT_MEMBER_NOTICE_MIN_HOURS = 12;
export const MAX_MEMBER_NOTICE_MIN_HOURS = 72;

/** Dikabarkan kurang dari N jam sebelum kelas → ditandai terlambat di laporan Program Director. */
export function isChangeNoticeLate(sessionStart: Date, now: Date, minHours: number): boolean {
  return sessionStart.getTime() - now.getTime() < minHours * 3_600_000;
}

/** Jam 08.00 WIB berikutnya (awal jam kirim). */
export function nextSendWindowOpen(now: Date): Date {
  const { date, hour } = wibNow(now);
  const open = new Date(`${date}T${String(QUIET_END_HOUR).padStart(2, "0")}:00:00+07:00`);
  if (hour < QUIET_END_HOUR) return open;
  return new Date(open.getTime() + 86_400_000);
}

/** Jarak minimal antara pesan pagi dan kelas — kurang dari ini pesan dikirim saat itu juga walau jam tenang. */
const URGENT_BUFFER_MS = 3 * 3_600_000;

/**
 * Kirim sekarang bila di jam layak (08.00–21.00 WIB), atau bila menunggu pagi
 * membuat member baru tahu kurang dari 3 jam sebelum kelas (mis. coach sakit
 * pukul 05.30 untuk kelas 07.00). Selain itu ditahan sampai 08.00.
 */
export function canSendChangeNow(now: Date, sessionStart: Date): boolean {
  if (inSendWindow(now)) return true;
  return sessionStart.getTime() < nextSendWindowOpen(now).getTime() + URGENT_BUFFER_MS;
}

/** Booking yang dibuat sebelum coach diganti boleh batal tanpa penalti sampai kelas mulai. */
export function freeCancelAfterCoachChange(bookedAt: string | Date | null, coachChangedAt: string | Date | null): boolean {
  if (!bookedAt || !coachChangedAt) return false;
  return new Date(bookedAt).getTime() < new Date(coachChangedAt).getTime();
}

export const changeDedupKey = {
  coachChanged: (bookingId: string, newCoachId: string) => `coach_change:${bookingId}:${newCoachId}`,
  cancelled: (bookingId: string) => `session_cancelled:${bookingId}`,
};

const time24 = (t: string) => t.slice(0, 5);

function sessionWhat(program: string, kind: string): string {
  if (kind !== "pt") return program;
  return /personal training/i.test(program) ? `your ${program} session` : `your Personal Training session (${program})`;
}

export interface ChangeMessageInput {
  name: string | null;
  program: string;
  kind: string;
  date: string;
  time: string;
  waitlisted: boolean;
  link: string;
}

export function coachChangedMessage(i: ChangeMessageInput & { newCoach: string; oldCoach: string | null }): string {
  return [
    `Hi ${firstName(i.name)}, a change to ${sessionWhat(i.program, i.kind)} on ${englishDate(i.date)} at ${time24(i.time)}:`,
    `${i.newCoach} will coach this session${i.oldCoach ? ` instead of ${i.oldCoach}` : ""}.`,
    i.waitlisted
      ? "You're still on the waitlist."
      : "Your spot is still locked in. Prefer to skip? Cancel in the Member App any time before the class starts — your credit comes back in full.",
    i.link,
  ].join("\n");
}

export function sessionCancelledMessage(i: ChangeMessageInput): string {
  return [
    `Hi ${firstName(i.name)}, sorry — ${sessionWhat(i.program, i.kind)} on ${englishDate(i.date)} at ${time24(i.time)} has been cancelled.`,
    i.waitlisted ? "You were on the waitlist, so no credit was used." : "Your credit is back on your pass.",
    `Book another session in the Member App: ${i.link}`,
  ].join("\n");
}
