"use client";

import { CalendarPlus } from "lucide-react";
import { sessionCalendarUrl } from "./calendar";
import { useMember } from "./member-app";

/**
 * Tombol "Add to Google Calendar" (revisi client 2026-10-22): membuka Google
 * Calendar di tab baru dengan acara sesi yang sudah terisi — member tinggal
 * menekan Simpan. Tidak butuh izin akun Google dari aplikasi ini.
 */
export function AddToGoogleCalendar({
  programName,
  kind,
  date,
  startTime,
  endTime,
  coachName,
  className = "",
}: {
  programName: string;
  kind: "class" | "pt";
  date: string;
  startTime: string;
  endTime: string;
  coachName: string | null;
  className?: string;
}) {
  const { cancelWindowHours, venue } = useMember();
  const href = sessionCalendarUrl({
    programName,
    kind,
    date,
    startTime,
    endTime,
    coachName,
    cancelWindowHours,
    appUrl: typeof window !== "undefined" ? `${window.location.origin}/member` : "",
    venue,
  });
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`flex min-h-12 w-full items-center justify-center gap-2 border border-white/30 px-5 py-3.5 text-xs font-bold uppercase tracking-[0.12em] text-white transition hover:border-nh-lime hover:text-nh-lime ${className}`}
    >
      <CalendarPlus className="size-4" /> Add to Google Calendar
    </a>
  );
}
