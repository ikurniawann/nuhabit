/**
 * Reschedule sesi Personal Training (EPIC-067 T-067-A7). Logika murni — query
 * di pt-reschedule-server.ts. Sesi dipindah di tempat, jadi booking & kredit
 * pass tidak berubah.
 */

import { sessionEpoch } from "@/lib/studio/booking";
import { englishDate, firstName } from "@/lib/studio/jobs";

export type RescheduleActor = "member" | "coach" | "staff";

export const MAX_PT_MEMBER_RESCHEDULE = 10;

export type RescheduleCheck = { ok: true } | { ok: false; reason: string };

/**
 * Boleh dipindah sekarang?
 *  - member: paling lambat batas batal (cancel_window_hours) sebelum jadwal lama — lewat dari itu
 *    reschedule jadi celah menghindari batal telat; maksimal `memberMax` kali per booking (0 = tidak boleh);
 *  - coach & staf: selama sesi belum mulai.
 * Jadwal baru selalu harus di masa depan.
 */
export function checkReschedule(i: {
  actor: RescheduleActor;
  nowMs: number;
  from: { date: string; time: string };
  to: { date: string; time: string };
  cancelWindowHours: number;
  memberCount: number;
  memberMax: number;
}): RescheduleCheck {
  // Member App berbahasa Inggris; backoffice & Coach Portal Indonesia.
  const say = (en: string, id: string): RescheduleCheck => ({ ok: false, reason: i.actor === "member" ? en : id });
  const fromMs = sessionEpoch(i.from.date, i.from.time);
  if (fromMs <= i.nowMs) return say("This session has already started.", "Sesi sudah mulai — tidak bisa dipindah");
  if (sessionEpoch(i.to.date, i.to.time) <= i.nowMs) return say("That time has already passed.", "Jadwal baru sudah lewat");
  if (i.from.date === i.to.date && i.from.time.slice(0, 5) === i.to.time.slice(0, 5)) {
    return say("That's the same time as your current booking.", "Jadwal baru sama dengan jadwal lama");
  }
  if (i.actor !== "member") return { ok: true };
  if (i.memberMax <= 0) return { ok: false, reason: "Reschedule from the Member App isn't available — please contact the studio." };
  if (i.memberCount >= i.memberMax) {
    return { ok: false, reason: `This session has already been rescheduled ${i.memberCount}× (limit ${i.memberMax}). Please contact the studio.` };
  }
  if (fromMs - i.nowMs < i.cancelWindowHours * 3_600_000) {
    return { ok: false, reason: `Sessions can be rescheduled up to ${i.cancelWindowHours} hours before they start. Please contact the studio.` };
  }
  return { ok: true };
}

/** Booking yang dibuat sebelum sesi dipindah coach/admin boleh batal tanpa penalti sampai sesi mulai. */
export function freeCancelAfterStudioReschedule(bookedAt: string | Date | null, rescheduledAt: string | Date | null): boolean {
  if (!bookedAt || !rescheduledAt) return false;
  return new Date(bookedAt).getTime() < new Date(rescheduledAt).getTime();
}

const time24 = (t: string) => t.slice(0, 5);

const what = (program: string) =>
  /personal training/i.test(program) ? `your ${program} session` : `your Personal Training session (${program})`;

/** WA ke member saat coach/admin memindah sesinya (bahasa Inggris, seperti pesan member lain). */
export function memberRescheduledMessage(i: {
  name: string | null;
  program: string;
  from: { date: string; time: string };
  to: { date: string; time: string };
  coach: string | null;
  reason?: string | null;
  link: string;
}): string {
  return [
    `Hi ${firstName(i.name)}, ${what(i.program)} has been moved.`,
    `New time: ${englishDate(i.to.date)} at ${time24(i.to.time)}${i.coach ? ` with ${i.coach}` : ""} (was ${englishDate(i.from.date)} at ${time24(i.from.time)}).`,
    ...(i.reason ? [`Note from the studio: ${i.reason}`] : []),
    "Your credit stays the same. Can't make the new time? Cancel in the Member App any time before the session — your credit comes back in full.",
    i.link,
  ].join("\n");
}

const tanggalId = (iso: string) =>
  new Date(`${iso}T00:00:00+07:00`).toLocaleDateString("id-ID", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Jakarta" });
const jadwal = (d: { date: string; time: string }) => `${tanggalId(d.date)} ${time24(d.time)}`;

const ACTOR_LABEL: Record<RescheduleActor, string> = { member: "member", coach: "coach", staff: "admin studio" };

/**
 * WA ke coach (bahasa Indonesia). `role`:
 *  - same: coach yang sama, jadwal pindah;
 *  - incoming: coach baru menerima sesi ini (admin mengganti coach);
 *  - outgoing: sesi dipindah ke coach lain — slot coach ini kosong.
 */
export function coachRescheduledMessage(i: {
  coachName: string;
  member: string;
  program: string;
  from: { date: string; time: string };
  to: { date: string; time: string };
  actor: RescheduleActor;
  role: "same" | "incoming" | "outgoing";
  otherCoach?: string | null;
  reason?: string | null;
  portalUrl: string;
}): string {
  const head =
    i.role === "incoming"
      ? `Halo ${i.coachName}, Anda mendapat sesi Personal Training ${i.program} dengan ${i.member}: ${jadwal(i.to)}.`
      : i.role === "outgoing"
        ? `Halo ${i.coachName}, sesi Personal Training ${i.program} dengan ${i.member} (${jadwal(i.from)}) dipindahkan ke ${i.otherCoach ?? "coach lain"} — slot Anda kosong.`
        : `Halo ${i.coachName}, sesi Personal Training ${i.program} dengan ${i.member} dipindah oleh ${ACTOR_LABEL[i.actor]}: ${jadwal(i.from)} → ${jadwal(i.to)}.`;
  return [head, i.reason ? `Alasan: ${i.reason}` : null, `Cek jadwal di Coach Portal: ${i.portalUrl}`].filter(Boolean).join("\n");
}
