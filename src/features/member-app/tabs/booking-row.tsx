"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useMember } from "../member-app";
import { friendlyDay, jam, memberFetch, type MyBooking } from "../lib";
import { Notice, PillButton, Sheet, Tag } from "../ui";

/** Jam tersisa sampai sesi mulai (WIB). */
export function hoursUntil(date: string, time: string): number {
  const start = Date.parse(`${date}T${time}:00+07:00`);
  return (start - Date.now()) / 3_600_000;
}

/** Konfirmasi batal: jelaskan apakah kredit kembali sesuai aturan venue. */
export function cancelNote(status: string, date: string, time: string, windowHours: number): string {
  if (status === "waitlisted") return "You'll leave the waitlist. No credit has been used.";
  return hoursUntil(date, time) >= windowHours
    ? `More than ${windowHours} hours before the session — your credit goes back to your pass.`
    : `Less than ${windowHours} hours before the session — the credit won't be returned.`;
}

export function BookingRow({ booking: b }: { booking: MyBooking }) {
  const { refresh, cancelWindowHours } = useMember();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  async function cancel() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await memberFetch<{ message: string }>(`/api/member-portal/studio/bookings/${b.id}/cancel`, { method: "POST", body: {} });
      setMsg({ tone: "ok", text: res.message });
      await refresh();
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof Error ? e.message : "Couldn't cancel" });
    } finally {
      setBusy(false);
    }
  }

  const late = b.status === "booked" && hoursUntil(b.session_date, b.start_time) < cancelWindowHours;

  return (
    <>
      <button type="button" onClick={() => { setMsg(null); setOpen(true); }} className="flex w-full items-center gap-4 border-b border-white/15 py-3.5 text-left transition hover:bg-white/[0.03]">
        <div className="flex w-20 shrink-0 items-stretch gap-2.5">
          <span className="w-0.5 bg-white" />
          <div>
            <p className="font-display text-xl font-bold leading-none tabular-nums text-white">{jam(b.start_time)}</p>
            <p className="mt-1 text-[9px] font-bold uppercase tracking-[0.1em] text-nh-beige/55">{friendlyDay(b.session_date)}</p>
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold uppercase tracking-[0.03em] text-white">{b.program_name}</p>
          <p className="truncate text-[11px] uppercase tracking-wide text-nh-beige/55">{b.coach_name ?? ""}</p>
        </div>
        <Tag tone={b.status === "waitlisted" ? "warn" : "lime"}>{b.status === "waitlisted" ? "Waitlist" : "Locked in"}</Tag>
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title={b.program_name}>
        <p className="text-xs font-semibold uppercase tracking-[0.1em] text-nh-beige/70">
          {friendlyDay(b.session_date)} · {jam(b.start_time)}–{jam(b.end_time)}
          {b.coach_name ? ` · ${b.coach_name}` : ""}
        </p>
        {msg ? (
          <div className="mt-5 space-y-4">
            <Notice tone={msg.tone}>{msg.text}</Notice>
            <PillButton variant="ghost" className="w-full" onClick={() => setOpen(false)}>Close</PillButton>
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            <div className={`border-l-2 px-4 py-3 text-sm ${late ? "border-nh-ochre bg-nh-ochre/10 text-nh-lemon" : "border-white/30 bg-white/[0.04] text-nh-beige/80"}`}>
              {cancelNote(b.status, b.session_date, b.start_time, cancelWindowHours)}
            </div>
            <PillButton variant="danger" className="w-full" disabled={busy} onClick={cancel}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              {b.status === "waitlisted" ? "Leave waitlist" : "Cancel booking"}
            </PillButton>
            <PillButton variant="ghost" className="w-full" onClick={() => setOpen(false)}>Keep my spot</PillButton>
          </div>
        )}
      </Sheet>
    </>
  );
}
