"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Plus } from "lucide-react";
import { useMember } from "../member-app";
import { addDaysIso, type ClassSlot, dateLabel, friendlyDay, jam, memberFetch, type ScheduleRules, wibToday } from "../lib";
import { Avatar, CenterSpinner, Empty, Eyebrow, Notice, PageTitle, PillButton, Sheet, Tag } from "../ui";
import { cancelNote, hoursUntil } from "./booking-row";

const DAY_LETTER = ["S", "M", "T", "W", "T", "F", "S"];

/** Senin dari minggu tanggal ini. */
function mondayOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const wd = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  return addDaysIso(date, -(wd - 1));
}

function minutesBetween(a: string, b: string): number {
  const [ah, am] = a.split(":").map(Number);
  const [bh, bm] = b.split(":").map(Number);
  return bh * 60 + bm - (ah * 60 + am);
}

function durationLabel(m: number): string {
  if (m === 60) return "1 hour";
  if (m > 60 && m % 60 === 0) return `${m / 60} hours`;
  return `${m} mins`;
}

/** Timetable mingguan — pola referensi: navigasi minggu, strip hari, baris jam + kartu sesi. */
export function ScheduleTab() {
  const { refresh, passes, go } = useMember();
  const [slots, setSlots] = useState<ClassSlot[] | null>(null);
  const [rules, setRules] = useState<ScheduleRules>({ cancel_window_hours: 12, booking_open_days: 7 });
  const today = wibToday();
  const [day, setDay] = useState(today);
  const [week, setWeek] = useState(mondayOf(today));
  const [selected, setSelected] = useState<ClassSlot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await memberFetch<{ data: ClassSlot[]; rules: ScheduleRules }>("/api/member-portal/studio/schedule");
      setSlots(res.data);
      setRules(res.rules);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the schedule");
      setSlots([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const lastBookable = addDaysIso(today, rules.booking_open_days);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDaysIso(week, i)), [week]);
  const canPrev = week > mondayOf(today);
  const canNext = addDaysIso(week, 7) <= lastBookable;

  const countByDay = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of slots ?? []) m.set(s.session_date, (m.get(s.session_date) ?? 0) + 1);
    return m;
  }, [slots]);

  // Sesi hari terpilih, dikelompokkan per jam mulai.
  const rows = useMemo(() => {
    const byTime = new Map<string, ClassSlot[]>();
    for (const s of (slots ?? []).filter((x) => x.session_date === day)) byTime.set(s.start_time, [...(byTime.get(s.start_time) ?? []), s]);
    return [...byTime.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [slots, day]);

  const classCredits = (passes ?? []).filter((p) => p.status === "active" || p.status === "scheduled").reduce((s, p) => s + p.class_left, 0);

  function shiftWeek(delta: number) {
    const next = addDaysIso(week, delta * 7);
    setWeek(next);
    const first = [0, 1, 2, 3, 4, 5, 6].map((i) => addDaysIso(next, i)).find((d) => d >= today && d <= lastBookable);
    if (first) setDay(first);
  }

  return (
    <div className="space-y-8">
      <PageTitle sub={`${classCredits} ${classCredits === 1 ? "class" : "classes"} left · free cancellation up to ${rules.cancel_window_hours} hours before`}>Timetable</PageTitle>

      <section>
        <p className="text-center text-sm font-bold uppercase tracking-[0.06em] text-white">NüHabit Hyrox Studio</p>
        <div className="mt-3 flex items-center justify-center gap-6">
          <button type="button" onClick={() => shiftWeek(-1)} disabled={!canPrev} aria-label="Previous week" className="p-1 text-white disabled:opacity-25">
            <ChevronLeft className="size-5" />
          </button>
          <p className="min-w-40 text-center text-lg font-semibold text-white">
            {dateLabel(weekDays[0])} – {dateLabel(weekDays[6])}
          </p>
          <button type="button" onClick={() => shiftWeek(1)} disabled={!canNext} aria-label="Next week" className="p-1 text-white disabled:opacity-25">
            <ChevronRight className="size-5" />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-7">
          {weekDays.map((d) => {
            const active = d === day;
            const bookable = d >= today && d <= lastBookable;
            const n = countByDay.get(d) ?? 0;
            const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
            return (
              <button
                key={d}
                type="button"
                disabled={!bookable}
                onClick={() => setDay(d)}
                className={`relative flex flex-col items-center py-2.5 transition disabled:opacity-30 ${active ? "bg-nh-lime text-black" : "text-white hover:bg-white/[0.06]"}`}
              >
                <span className="text-[11px] font-semibold">{DAY_LETTER[dow]}</span>
                <span className="font-display text-xl font-bold leading-tight">{dateLabel(d).split(" ")[0]}</span>
                <span className={`mt-0.5 h-0.5 w-5 ${active ? "bg-black" : n > 0 && bookable ? "bg-white/50" : "bg-transparent"}`} />
              </button>
            );
          })}
        </div>
      </section>

      {error && <Notice tone="error">{error}</Notice>}
      {!slots ? (
        <CenterSpinner />
      ) : rows.length === 0 ? (
        <Empty title="No classes on this day." hint="Try another day." />
      ) : (
        <section className="space-y-2">
          <Eyebrow>{friendlyDay(day)}</Eyebrow>
          {rows.map(([time, list]) => (
            <div key={time} className="flex gap-3">
              <div className="flex w-16 shrink-0 gap-2.5 py-1">
                <span className="w-0.5 bg-white" />
                <p className="font-display text-xl font-bold leading-none tabular-nums text-white">{jam(time)}</p>
              </div>
              <div className="relative grid flex-1 grid-cols-2 gap-1.5">
                {list.map((s, i) => (
                  <SessionCard key={s.id} slot={s} onOpen={() => setSelected(s)} joiner={i % 2 === 1} />
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      {selected && (
        <SlotSheet
          slot={selected}
          rules={rules}
          hasCredit={classCredits > 0}
          onClose={() => setSelected(null)}
          onBuy={() => { setSelected(null); go("passes"); }}
          onChanged={async () => {
            await Promise.all([load(), refresh()]);
          }}
        />
      )}
    </div>
  );
}

/** Kartu sesi kotak abu-abu; kartu kedua di jam sama diberi penghubung "+" seperti referensi. */
function SessionCard({ slot: s, onOpen, joiner }: { slot: ClassSlot; onOpen: () => void; joiner: boolean }) {
  const full = s.spots_left <= 0;
  const mins = minutesBetween(s.start_time, s.end_time);
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`relative min-h-[5.5rem] p-2.5 text-left transition ${s.my_status ? "bg-nh-lime/15 outline outline-1 outline-nh-lime" : "bg-white/[0.09] hover:bg-white/[0.15]"}`}
    >
      {joiner && (
        <span className="absolute -left-[13px] top-1/2 z-10 flex size-5 -translate-y-1/2 items-center justify-center rounded-full bg-black text-white">
          <Plus className="size-3" strokeWidth={3} />
        </span>
      )}
      <p className="line-clamp-2 text-xs font-bold uppercase leading-tight tracking-[0.02em] text-white">{s.program_name}</p>
      {s.level_label && <p className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-nh-beige/60">{s.level_label}</p>}
      <p className="mt-0.5 text-[9px] uppercase tracking-[0.08em] text-nh-beige/60">{durationLabel(mins)}</p>
      <div className="mt-2 flex items-center justify-between gap-1">
        <span className="truncate text-[9px] uppercase tracking-[0.06em] text-nh-beige/50">{s.coach_name ?? "Coach TBA"}</span>
        {s.my_status === "booked" ? (
          <span className="shrink-0 text-[9px] font-bold uppercase text-nh-lime">Booked</span>
        ) : s.my_status === "waitlisted" ? (
          <span className="shrink-0 text-[9px] font-bold uppercase text-nh-lemon">Waitlist</span>
        ) : full ? (
          <span className="shrink-0 text-[9px] font-bold uppercase text-red-200">Full</span>
        ) : (
          <span className={`shrink-0 text-[9px] font-bold uppercase ${s.spots_left <= 2 ? "text-nh-lime" : "text-nh-beige/60"}`}>{s.spots_left} left</span>
        )}
      </div>
    </button>
  );
}

/** "See you tomorrow at 06:30" / "See you Saturday, 4 Oct at 06:30". */
function seeYou(date: string): string {
  const d = friendlyDay(date);
  return d === "Today" ? "later today" : d === "Tomorrow" ? "tomorrow" : d;
}

function SlotSheet({
  slot: s,
  rules,
  hasCredit,
  onClose,
  onBuy,
  onChanged,
}: {
  slot: ClassSlot;
  rules: ScheduleRules;
  hasCredit: boolean;
  onClose: () => void;
  onBuy: () => void;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const full = s.spots_left <= 0;

  async function act(kind: "book" | "cancel") {
    setBusy(true);
    setMsg(null);
    try {
      const res =
        kind === "book"
          ? await memberFetch<{ message: string }>("/api/member-portal/studio/bookings", { method: "POST", body: { session_id: s.id } })
          : await memberFetch<{ message: string }>(`/api/member-portal/studio/bookings/${s.my_booking_id}/cancel`, { method: "POST", body: {} });
      setMsg({ tone: "ok", text: kind === "book" && !full ? `You're locked in. See you ${seeYou(s.session_date)} at ${jam(s.start_time)}.` : res.message });
      await onChanged();
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof Error ? e.message : "Something went wrong" });
    } finally {
      setBusy(false);
    }
  }

  const late = hoursUntil(s.session_date, s.start_time) < rules.cancel_window_hours;

  return (
    <Sheet open onClose={onClose} title={s.program_name}>
      <div className="space-y-6">
        <div className="grid grid-cols-3 border border-white/15">
          <Fact label="Day" value={friendlyDay(s.session_date)} />
          <Fact label="Time" value={`${jam(s.start_time)}–${jam(s.end_time)}`} border />
          <Fact label="Spots" value={full ? "Full" : `${s.spots_left}/${s.capacity}`} border />
        </div>
        {s.level_label && <Tag>{s.level_label}</Tag>}
        {s.program_description && <p className="text-sm leading-relaxed text-nh-beige/85">{s.program_description}</p>}
        {s.coach_name && (
          <div className="flex items-center gap-4 border-y border-white/15 py-4">
            <Avatar name={s.coach_name} photo={s.coach_photo} size={56} />
            <div>
              <Eyebrow>Coach</Eyebrow>
              <p className="mt-1 font-display text-xl font-bold uppercase leading-none text-white">{s.coach_name}</p>
            </div>
          </div>
        )}
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-nh-beige/70">
          {full ? `Class full · ${s.waitlist_count} on the waitlist` : s.spots_left === 1 ? "There's room for one more." : `${s.spots_left} of ${s.capacity} spots left`}
        </p>

        <div className="space-y-3">
          {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
          {msg?.tone === "ok" ? (
            <PillButton variant="ghost" className="w-full" onClick={onClose}>Close</PillButton>
          ) : s.my_status ? (
            <>
              <div className={`border-l-2 px-4 py-3 text-sm ${late && s.my_status === "booked" ? "border-nh-ochre bg-nh-ochre/10 text-nh-lemon" : "border-white/30 bg-white/[0.04] text-nh-beige/80"}`}>
                {cancelNote(s.my_status, s.session_date, s.start_time, rules.cancel_window_hours)}
              </div>
              <PillButton variant="danger" className="w-full" disabled={busy} onClick={() => act("cancel")}>
                {busy && <Loader2 className="size-4 animate-spin" />}
                {s.my_status === "waitlisted" ? "Leave waitlist" : "Cancel booking"}
              </PillButton>
            </>
          ) : !hasCredit ? (
            <>
              <div className="border-l-2 border-white/30 bg-white/[0.04] px-4 py-3 text-sm text-nh-beige/80">You&apos;re out of class credits. Choose a pass to keep training.</div>
              <PillButton className="w-full" onClick={onBuy}>See passes</PillButton>
            </>
          ) : (
            <>
              <p className="text-xs text-nh-beige/55">Booking locks in 1 class credit. Cancel at least {rules.cancel_window_hours} hours before and it&apos;s returned.</p>
              <PillButton className="w-full" disabled={busy} onClick={() => act("book")}>
                {busy && <Loader2 className="size-4 animate-spin" />}
                {full ? "Join waitlist" : "Book this session"}
              </PillButton>
            </>
          )}
        </div>
      </div>
    </Sheet>
  );
}

function Fact({ label, value, border }: { label: string; value: string; border?: boolean }) {
  return (
    <div className={`px-3 py-3 ${border ? "border-l border-white/15" : ""}`}>
      <Eyebrow className="text-[9px]">{label}</Eyebrow>
      <p className="mt-1 text-sm font-bold uppercase leading-tight text-white">{value}</p>
    </div>
  );
}
