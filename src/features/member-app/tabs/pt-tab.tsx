"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, ChevronRight, Loader2 } from "lucide-react";
import { useMember } from "../member-app";
import { addDaysIso, dateLabel, dayShort, friendlyDay, jam, memberFetch, type PtCatalogEntry, wibToday } from "../lib";
import { Avatar, CenterSpinner, Empty, Eyebrow, Notice, PageTitle, PillButton, SectionTitle, Sheet, SideLabel, Tag } from "../ui";
import { BookingRow } from "./booking-row";

type Coach = PtCatalogEntry["coaches"][number];

const coachName = (c: Coach) => c.display_name || c.full_name;

/** Booking Personal Training: program → coach → tanggal → jam → konfirmasi. */
export function PtTab() {
  const { passes, bookings, refresh, go } = useMember();
  const [catalog, setCatalog] = useState<PtCatalogEntry[] | null>(null);
  const [programId, setProgramId] = useState<string | null>(null);
  const [coach, setCoach] = useState<Coach | null>(null);
  const [date, setDate] = useState(wibToday());
  const [slots, setSlots] = useState<string[] | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    memberFetch<{ data: PtCatalogEntry[] }>("/api/member-portal/studio/pt/catalog")
      .then((r) => {
        // Program tanpa coach tidak bisa dibooking — jangan tampilkan ke member.
        const bookable = r.data.filter((p) => p.coaches.length > 0);
        setCatalog(bookable);
        if (bookable.length === 1) setProgramId(bookable[0].id);
      })
      .catch(() => setCatalog([]));
  }, []);

  const program = catalog?.find((p) => p.id === programId) ?? null;
  const ptLeft = (passes ?? []).filter((p) => p.status === "active" || p.status === "scheduled").reduce((s, p) => s + p.pt_left, 0);
  const myPt = (bookings ?? []).filter((b) => b.program_kind === "pt" && b.upcoming && b.status === "booked");

  const loadSlots = useCallback(async () => {
    if (!program || !coach) return;
    setSlots(null);
    try {
      const r = await memberFetch<{ data: { coach: { id: string }; slots: string[] }[] }>(
        `/api/member-portal/studio/pt/slots?program_id=${program.id}&date=${date}&coach_id=${coach.id}`
      );
      setSlots(r.data[0]?.slots ?? []);
    } catch {
      setSlots([]);
    }
  }, [program, coach, date]);

  useEffect(() => {
    void loadSlots();
  }, [loadSlots]);

  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => addDaysIso(wibToday(), i)), []);

  async function book() {
    if (!program || !coach || !time) return;
    setBusy(true);
    setMsg(null);
    try {
      await memberFetch("/api/member-portal/studio/pt/bookings", { method: "POST", body: { program_id: program.id, coach_id: coach.id, date, start_time: time } });
      setMsg({ tone: "ok", text: `Your Personal Training session is locked in. See you ${friendlyDay(date).replace(/^(Today|Tomorrow)$/, (d) => d.toLowerCase())} at ${jam(time)} with ${coachName(coach)}.` });
      await Promise.all([refresh(), loadSlots()]);
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof Error ? e.message : "Couldn't book this session" });
    } finally {
      setBusy(false);
    }
  }

  if (!catalog) return <CenterSpinner />;

  const step = !program ? 1 : !coach ? 2 : 3;

  return (
    <div className="space-y-10">
      <PageTitle sub={`One-on-one with the coach of your choice · ${ptLeft} ${ptLeft === 1 ? "session" : "sessions"} left`}>
        Personal
        <br />
        training
      </PageTitle>

      {myPt.length > 0 && !coach && (
        <section>
          <SectionTitle>Booked</SectionTitle>
          <div className="border-t border-white/15">
            {myPt.map((b) => (
              <BookingRow key={b.id} booking={b} />
            ))}
          </div>
        </section>
      )}

      {catalog.length === 0 ? (
        <Empty title="No Personal Training programs yet." hint="Ask the front desk about upcoming availability." />
      ) : ptLeft === 0 && !coach ? (
        <div className="flex border border-white/15">
          <SideLabel>Credits</SideLabel>
          <div className="flex-1 p-5">
            <p className="font-display text-xl font-bold uppercase leading-tight text-white">No Personal Training credits yet.</p>
            <p className="mt-2 text-sm text-nh-beige/65">Choose a pass that includes Personal Training to start booking.</p>
            <PillButton className="mt-4" variant="light" onClick={() => go("passes")}>See passes</PillButton>
          </div>
        </div>
      ) : null}

      {catalog.length > 0 && (
        <ol className="flex border-y border-white/15 text-[10px] font-bold uppercase tracking-[0.12em]">
          {["Program", "Coach", "Date & time"].map((label, i) => (
            <li key={label} className={`flex-1 py-2.5 text-center ${i > 0 ? "border-l border-white/15" : ""} ${step === i + 1 ? "bg-nh-lime text-black" : step > i + 1 ? "text-white" : "text-nh-beige/40"}`}>
              {String(i + 1).padStart(2, "0")}. {label}
            </li>
          ))}
        </ol>
      )}

      {catalog.length > 0 && !program && (
        <section className="border-t border-white/15">
          {catalog.map((p, i) => (
            <button key={p.id} type="button" onClick={() => setProgramId(p.id)} className="group flex w-full items-start justify-between gap-4 border-b border-white/15 py-5 text-left">
              <span className="min-w-0">
                <Eyebrow>{String(i + 1).padStart(2, "0")}</Eyebrow>
                <span className="mt-1 block font-display text-2xl font-bold uppercase leading-[0.95] tracking-tight text-white group-hover:text-nh-lime">{p.name}</span>
                <span className="mt-2 block text-[10px] font-semibold uppercase tracking-[0.12em] text-nh-beige/60">
                  {p.duration_minutes} min{p.level_label ? ` · ${p.level_label}` : ""} · {p.coaches.length} {p.coaches.length === 1 ? "coach" : "coaches"}
                </span>
                {p.description && <span className="mt-2 block text-sm text-nh-beige/70">{p.description}</span>}
              </span>
              <span className="mt-6 flex size-8 shrink-0 items-center justify-center rounded-full bg-nh-beige text-black">
                <ChevronRight className="size-4" />
              </span>
            </button>
          ))}
        </section>
      )}

      {program && !coach && (
        <section>
          {catalog.length > 1 && (
            <button type="button" onClick={() => setProgramId(null)} className="mb-4 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-nh-beige/70 hover:text-white">
              <ArrowLeft className="size-3.5" /> {program.name}
            </button>
          )}
          <SectionTitle>Choose a coach</SectionTitle>
          {program.coaches.length === 0 ? (
            <Empty title="No coaches for this program yet." />
          ) : (
            <div className="border-t border-white/15">
              {program.coaches.map((c) => (
                <button key={c.id} type="button" onClick={() => { setCoach(c); setTime(null); setMsg(null); }} className="group flex w-full gap-4 border-b border-white/15 py-4 text-left">
                  <Avatar name={coachName(c)} photo={c.photo_url} size={88} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="font-display text-xl font-bold uppercase leading-none tracking-tight text-white group-hover:text-nh-lime">{coachName(c)}</span>
                    </span>
                    {c.level === "head_coach" && <span className="mt-1.5 block text-[9px] font-bold uppercase tracking-[0.14em] text-nh-lime">Head Coach</span>}
                    {c.bio && <span className="mt-1.5 line-clamp-2 block text-xs text-nh-beige/70">{c.bio}</span>}
                    {c.specialties && c.specialties.length > 0 && (
                      <span className="mt-2 flex flex-wrap gap-1">
                        {c.specialties.slice(0, 3).map((s) => (
                          <Tag key={s}>{s}</Tag>
                        ))}
                      </span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {program && coach && (
        <section className="space-y-6">
          <button type="button" onClick={() => setCoach(null)} className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-nh-beige/70 hover:text-white">
            <ArrowLeft className="size-3.5" /> Change coach
          </button>
          <div className="flex items-center gap-4 border-y border-white/15 py-4">
            <Avatar name={coachName(coach)} photo={coach.photo_url} size={64} />
            <div>
              <p className="font-display text-2xl font-bold uppercase leading-none tracking-tight text-white">{coachName(coach)}</p>
              <p className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-nh-beige/60">
                {program.name} · {program.duration_minutes} min
              </p>
            </div>
          </div>

          <div>
            <Eyebrow className="mb-2">Date</Eyebrow>
            <div className="-mx-5 flex gap-px overflow-x-auto border-y border-white/15 px-5 [scrollbar-width:none]">
              {days.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => { setDate(d); setTime(null); setMsg(null); }}
                  className={`flex w-14 shrink-0 flex-col items-center py-2.5 ${d === date ? "bg-nh-lime text-black" : "text-white hover:bg-white/[0.06]"}`}
                >
                  <span className="text-[11px] font-semibold">{dayShort(d)}</span>
                  <span className="font-display text-xl font-bold leading-tight">{dateLabel(d).split(" ")[0]}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <Eyebrow className="mb-2">Available times · {friendlyDay(date)}</Eyebrow>
            {!slots ? (
              <CenterSpinner />
            ) : slots.length === 0 ? (
              <Empty title="No open times." hint="Try another date or coach." />
            ) : (
              <div className="grid grid-cols-4 gap-1.5">
                {slots.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => { setTime(t); setMsg(null); }}
                    className={`py-3 font-display text-base font-bold tabular-nums ${t === time ? "bg-nh-lime text-black" : "bg-white/[0.09] text-white hover:bg-white/[0.16]"}`}
                  >
                    {jam(t)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      <Sheet open={!!(coach && time && program)} onClose={() => { setTime(null); setMsg(null); }} title="Confirm Personal Training">
        {program && coach && time && (
          <div className="space-y-4">
            <div className="border border-white/15 p-4">
              <p className="font-display text-5xl font-bold text-nh-lime tabular-nums">{jam(time)}</p>
              <p className="mt-2 text-sm font-bold uppercase tracking-[0.06em] text-white">{friendlyDay(date)}</p>
              <p className="text-xs uppercase tracking-wide text-nh-beige/70">
                {program.name} with {coachName(coach)}
              </p>
            </div>
            {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
            {msg?.tone === "ok" ? (
              <PillButton className="w-full" onClick={() => { setTime(null); setMsg(null); setCoach(null); }}>
                <Check className="size-4" /> Done
              </PillButton>
            ) : ptLeft === 0 ? (
              <>
                <div className="border-l-2 border-white/30 bg-white/[0.04] px-4 py-3 text-sm text-nh-beige/80">You&apos;re out of Personal Training credits.</div>
                <PillButton className="w-full" onClick={() => go("passes")}>See passes</PillButton>
              </>
            ) : (
              <>
                <p className="text-xs text-nh-beige/50">Booking locks in 1 Personal Training credit. Cancel in time and it&apos;s returned.</p>
                <PillButton className="w-full" disabled={busy} onClick={book}>
                  {busy && <Loader2 className="size-4 animate-spin" />}
                  Lock in this session
                </PillButton>
              </>
            )}
          </div>
        )}
      </Sheet>
    </div>
  );
}
