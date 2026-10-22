"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, Loader2 } from "lucide-react";
import { useMember } from "../member-app";
import { addDaysIso, dateLabel, dayShort, friendlyDay, jam, memberFetch, type MyBooking, wibToday } from "../lib";
import { Notice, PillButton, Sheet, Tag } from "../ui";
import { AddToGoogleCalendar } from "../add-to-calendar";

/** Jam tersisa sampai sesi mulai (WIB). */
export function hoursUntil(date: string, time: string): number {
  const start = Date.parse(`${date}T${time}:00+07:00`);
  return (start - Date.now()) / 3_600_000;
}

/** Konfirmasi batal: jelaskan apakah kredit kembali sesuai aturan venue. */
export function cancelNote(status: string, date: string, time: string, windowHours: number, freeCancel = false, studioRescheduled = false): string {
  if (status === "waitlisted") return "You'll leave the waitlist. No credit has been used.";
  if (freeCancel && studioRescheduled) return "This session was moved by the studio, so you can cancel free of charge — your credit goes back to your pass.";
  if (freeCancel) return "Your coach for this session has changed, so you can cancel free of charge — your credit goes back to your pass.";
  return hoursUntil(date, time) >= windowHours
    ? `More than ${windowHours} hours before the session — your credit goes back to your pass.`
    : `Less than ${windowHours} hours before the session — the credit won't be returned.`;
}

export function BookingRow({ booking: b }: { booking: MyBooking }) {
  const { refresh, cancelWindowHours, ptRescheduleMax } = useMember();
  const [open, setOpen] = useState(false);
  const [moving, setMoving] = useState(false);
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

  const late = b.status === "booked" && !b.free_cancel && hoursUntil(b.session_date, b.start_time) < cancelWindowHours;
  // Reschedule Personal Training (T-067-A7): paling lambat batas batal, maksimal N kali per booking.
  const canReschedule = b.program_kind === "pt" && b.status === "booked" && Boolean(b.program_id && b.coach_id) && ptRescheduleMax > 0;
  const reschedulesLeft = ptRescheduleMax - (b.member_reschedules ?? 0);
  const rescheduleBlocked =
    reschedulesLeft <= 0
      ? `You've used all ${ptRescheduleMax} reschedules for this booking. Please contact the studio.`
      : hoursUntil(b.session_date, b.start_time) < cancelWindowHours
        ? `Sessions can be rescheduled up to ${cancelWindowHours} hours before they start. Please contact the studio.`
        : null;

  return (
    <>
      <button type="button" onClick={() => { setMsg(null); setMoving(false); setOpen(true); }} className="flex w-full items-center gap-4 border-b border-white/15 py-3.5 text-left transition hover:bg-white/[0.03]">
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
          {b.free_cancel && b.status === "booked" && (
            <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-nh-lemon">{b.studio_rescheduled ? "Moved by studio" : "Coach changed"} · free cancel</p>
          )}
        </div>
        <Tag tone={b.status === "waitlisted" ? "warn" : "lime"}>{b.status === "waitlisted" ? "Waitlist" : "Locked in"}</Tag>
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title={b.program_name}>
        <p className="text-xs font-semibold uppercase tracking-[0.1em] text-nh-beige/70">
          {friendlyDay(b.session_date)} · {jam(b.start_time)}–{jam(b.end_time)}
          {b.coach_name ? ` · ${b.coach_name}` : ""}
        </p>
        {moving && !msg ? (
          <RescheduleFlow
            booking={b}
            onCancel={() => setMoving(false)}
            onDone={async (text) => {
              setMsg({ tone: "ok", text });
              await refresh();
            }}
          />
        ) : msg ? (
          <div className="mt-5 space-y-4">
            <Notice tone={msg.tone}>{msg.text}</Notice>
            <PillButton variant="ghost" className="w-full" onClick={() => setOpen(false)}>Close</PillButton>
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            {b.status === "booked" && (
              <AddToGoogleCalendar
                programName={b.program_name}
                kind={b.program_kind === "pt" ? "pt" : "class"}
                date={b.session_date}
                startTime={b.start_time}
                endTime={b.end_time}
                coachName={b.coach_name}
              />
            )}
            <div className={`border-l-2 px-4 py-3 text-sm ${late ? "border-nh-ochre bg-nh-ochre/10 text-nh-lemon" : "border-white/30 bg-white/[0.04] text-nh-beige/80"}`}>
              {cancelNote(b.status, b.session_date, b.start_time, cancelWindowHours, b.free_cancel, b.studio_rescheduled)}
            </div>
            {canReschedule &&
              (rescheduleBlocked ? (
                <p className="text-xs text-nh-beige/60">{rescheduleBlocked}</p>
              ) : (
                <PillButton variant="light" className="w-full" onClick={() => setMoving(true)}>
                  <CalendarClock className="size-4" /> Reschedule · keeps your credit
                </PillButton>
              ))}
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

/** Pindah ke jam kosong coach yang sama — kredit tetap terkunci di booking ini. */
function RescheduleFlow({ booking: b, onCancel, onDone }: { booking: MyBooking; onCancel: () => void; onDone: (message: string) => Promise<void> }) {
  const [date, setDate] = useState(b.session_date >= wibToday() ? b.session_date : wibToday());
  const [slots, setSlots] = useState<string[] | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => addDaysIso(wibToday(), i)), []);

  const load = useCallback(
    () =>
      memberFetch<{ data: { slots: string[] }[] }>(
        `/api/member-portal/studio/pt/slots?program_id=${b.program_id}&date=${date}&coach_id=${b.coach_id}&booking_id=${b.id}`
      )
        .then((r) => setSlots((r.data[0]?.slots ?? []).filter((t) => !(date === b.session_date && t === b.start_time))))
        .catch(() => setSlots([])),
    [b.program_id, b.coach_id, b.id, b.session_date, b.start_time, date]
  );

  useEffect(() => {
    void load();
  }, [load]);

  async function confirm() {
    if (!time) return;
    setBusy(true);
    setError(null);
    try {
      const r = await memberFetch<{ message: string }>(`/api/member-portal/studio/pt/bookings/${b.id}/reschedule`, {
        method: "POST",
        body: { date, start_time: time },
      });
      await onDone(r.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't reschedule");
      void load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-5 space-y-4">
      <p className="text-sm text-nh-beige/80">Pick a new time with {b.coach_name ?? "your coach"}. Your credit stays the same.</p>
      <div className="-mx-5 flex gap-px overflow-x-auto border-y border-white/15 px-5 [scrollbar-width:none]">
        {days.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => { setDate(d); setTime(null); setSlots(null); }}
            className={`flex w-14 shrink-0 flex-col items-center py-2.5 ${d === date ? "bg-nh-lime text-black" : "text-white hover:bg-white/[0.06]"}`}
          >
            <span className="text-[11px] font-semibold">{dayShort(d)}</span>
            <span className="font-display text-xl font-bold leading-tight">{dateLabel(d).split(" ")[0]}</span>
          </button>
        ))}
      </div>
      {!slots ? (
        <Loader2 className="mx-auto size-5 animate-spin text-nh-lime" />
      ) : slots.length === 0 ? (
        <p className="text-sm text-nh-beige/60">No open times on {friendlyDay(date)}. Try another date.</p>
      ) : (
        <div className="grid grid-cols-4 gap-1.5">
          {slots.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTime(t)}
              className={`py-3 font-display text-base font-bold tabular-nums ${t === time ? "bg-nh-lime text-black" : "bg-white/[0.09] text-white hover:bg-white/[0.16]"}`}
            >
              {jam(t)}
            </button>
          ))}
        </div>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      <PillButton className="w-full" disabled={!time || busy} onClick={confirm}>
        {busy && <Loader2 className="size-4 animate-spin" />}
        {time ? `Move to ${friendlyDay(date)} · ${jam(time)}` : "Choose a time"}
      </PillButton>
      <PillButton variant="ghost" className="w-full" onClick={onCancel}>Back</PillButton>
    </div>
  );
}
