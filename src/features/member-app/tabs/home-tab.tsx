"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { ArrowRight, ChevronRight } from "lucide-react";
import { useMember } from "../member-app";
import { addDaysIso, type CoachProfile, firstName, friendlyDay, jam, memberFetch, wibToday } from "../lib";
import { CenterSpinner, Eyebrow, MarqueeWordmark, PillButton, SectionTitle, SideLabel, Tag, TextAction } from "../ui";
import { BookingRow } from "./booking-row";
import { CoachSheet } from "./coaches-tab";
import { NewsSection } from "./news-section";

/** Beranda Member App — struktur halaman studio referensi (hero, tombol bertumpuk, blok berlabel, carousel, footer). */
export function HomeTab() {
  const { profile, passes, bookings, go } = useMember();
  const [coaches, setCoaches] = useState<CoachProfile[] | null>(null);
  const [coach, setCoach] = useState<CoachProfile | null>(null);

  useEffect(() => {
    memberFetch<{ data: CoachProfile[] }>("/api/member-portal/studio/coaches")
      .then((r) => setCoaches(r.data))
      .catch(() => setCoaches([]));
  }, []);

  const upcoming = useMemo(
    () =>
      (bookings ?? [])
        .filter((b) => b.upcoming && (b.status === "booked" || b.status === "waitlisted"))
        .sort((a, b) => (a.session_date + a.start_time).localeCompare(b.session_date + b.start_time)),
    [bookings]
  );
  const next = upcoming[0];
  const active = (passes ?? []).filter((p) => p.status === "active");
  const classLeft = active.reduce((s, p) => s + p.class_left, 0);
  const ptLeft = active.reduce((s, p) => s + p.pt_left, 0);
  const soonest = active.map((p) => p.valid_until).sort()[0];

  // Sesi hadir 7 hari terakhir.
  const weekAgo = addDaysIso(wibToday(), -7);
  const attendedThisWeek = (bookings ?? []).filter((b) => b.status === "attended" && b.session_date >= weekAgo && b.session_date <= wibToday()).length;

  if (!passes || !bookings) return <CenterSpinner />;

  return (
    <div className="space-y-12">
      {/* Hero */}
      <section className="pt-8">
        <div className="flex items-center justify-between gap-3">
          <Eyebrow>Welcome back</Eyebrow>
          <TierChip onOpen={() => go("profile")} />
        </div>
        <h1 className="mt-3 font-display text-[3.4rem] font-bold uppercase leading-[0.88] tracking-[-0.03em] text-white">
          {firstName(profile.name)}.
        </h1>
        <p className="mt-4 text-xs font-medium uppercase leading-relaxed tracking-wide text-nh-beige/70">
          {next ? "Your next session awaits. Train with purpose and consistency." : "Start with one session. Every athlete starts somewhere."}
        </p>
      </section>

      {/* Tombol bertumpuk */}
      <section className="space-y-2">
        <PillButton variant="light" className="w-full" onClick={() => go("schedule")}>
          Book a class
        </PillButton>
        <PillButton variant="ghost" className="w-full" arrow onClick={() => go("pt")}>
          Personal Training
        </PillButton>
        <PillButton variant="ghost" className="w-full" arrow onClick={() => go("passes")}>
          My passes
        </PillButton>
      </section>

      {/* Sesi berikutnya */}
      <section className="flex border border-white/15">
        <SideLabel tone="lime">Next up</SideLabel>
        {next ? (
          <div className="relative min-w-0 flex-1 overflow-hidden">
            <Image src="/brand/wallpaper-ink.webp" alt="" fill className="object-cover opacity-30" />
            <div className="relative p-5">
              <div className="flex items-center justify-between">
                <Tag tone={next.status === "waitlisted" ? "warn" : "lime"}>{next.status === "waitlisted" ? "Waitlist" : "Locked in"}</Tag>
                <Eyebrow className="text-nh-beige/80">{friendlyDay(next.session_date)}</Eyebrow>
              </div>
              <p className="mt-5 font-display text-6xl font-bold leading-none tracking-[-0.03em] text-white tabular-nums">{jam(next.start_time)}</p>
              <p className="mt-2 font-display text-2xl font-bold uppercase leading-none tracking-tight text-white">{next.program_name}</p>
              {next.coach_name && <p className="mt-1.5 text-xs font-semibold uppercase tracking-[0.1em] text-nh-beige/70">With {next.coach_name}</p>}
              {upcoming.length > 1 && <p className="mt-4 text-[11px] uppercase tracking-wide text-nh-beige/55">+{upcoming.length - 1} more booked</p>}
            </div>
          </div>
        ) : (
          <div className="flex-1 p-5">
            <p className="font-display text-2xl font-bold uppercase leading-tight tracking-tight text-white">No sessions yet.</p>
            <p className="mt-2 text-sm text-nh-beige/70">Pick a class this week and lock in your spot.</p>
            <button type="button" onClick={() => go("schedule")} className="mt-5 inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-nh-lime">
              Open timetable <ArrowRight className="size-3.5" />
            </button>
          </div>
        )}
      </section>

      {/* Angka */}
      <section className="grid grid-cols-3 border border-white/15">
        <Stat label="Classes left" value={classLeft} onClick={() => go("passes")} />
        <Stat label="Personal Training" value={ptLeft} onClick={() => go("pt")} border />
        <Stat label="This week" value={attendedThisWeek} onClick={() => go("profile")} border />
        <div className="col-span-3 border-t border-white/15 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-nh-beige/55">
          {soonest ? `Pass valid until ${friendlyDay(soonest)}` : "No active pass yet"}
          {active.length > 0 && classLeft + ptLeft <= 1 && (
            <button type="button" onClick={() => go("passes")} className="ml-2 text-nh-lime underline underline-offset-4">
              Only {classLeft + ptLeft} left — renew
            </button>
          )}
        </div>
      </section>

      {upcoming.length > 0 && (
        <section>
          <SectionTitle action={<TextAction onClick={() => go("schedule")}>Timetable</TextAction>}>My bookings</SectionTitle>
          <div className="border-t border-white/15">
            {upcoming.slice(0, 5).map((b) => (
              <BookingRow key={b.id} booking={b} />
            ))}
          </div>
        </section>
      )}

      <NewsSection onSeeAll={() => go("news")} />

      {/* Coaches — strip berlabel vertikal */}
      <section>
        <SectionTitle action={<TextAction onClick={() => go("coaches")}>All coaches</TextAction>}>The coaches</SectionTitle>
        {!coaches ? (
          <CenterSpinner />
        ) : coaches.length === 0 ? (
          <p className="text-sm text-nh-beige/50">Coach profiles coming soon.</p>
        ) : (
          <div className="flex h-56 border border-white/15">
            <SideLabel>Coaches</SideLabel>
            <div className="flex flex-1 gap-px overflow-x-auto bg-white/12 [scrollbar-width:none]">
              {coaches.map((c) => (
                <button key={c.id} type="button" onClick={() => setCoach(c)} className="group relative h-full w-40 shrink-0 overflow-hidden bg-black text-left">
                  {c.photo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.photo_url} alt={c.name} className="absolute inset-0 size-full object-cover grayscale transition group-hover:scale-105" />
                  ) : (
                    <span className="absolute inset-0 flex items-center justify-center bg-nh-everglade font-display text-4xl font-bold text-nh-lime">
                      {c.name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("")}
                    </span>
                  )}
                  <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black to-transparent p-3 pt-8">
                    <span className="block truncate font-display text-base font-bold uppercase leading-tight text-white">{c.name}</span>
                    <span className="flex items-center justify-between text-[9px] font-bold uppercase tracking-[0.14em] text-nh-lime">
                      {c.level === "head_coach" ? "Head Coach" : "Coach"}
                      <ChevronRight className="size-3.5 text-white" />
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Kaki halaman: blok CTA + wordmark berjalan */}
      <footer className="-mx-5">
        <div className="grid grid-cols-2 gap-px bg-black/20">
          <FooterCta label="Timetable" onClick={() => go("schedule")} />
          <FooterCta label="Progress" onClick={() => go("profile")} />
          <FooterCta label="Buy a pass" onClick={() => go("passes")} wide />
        </div>
        <MarqueeWordmark />
      </footer>
      <CoachSheet coach={coach} onClose={() => setCoach(null)} />
    </div>
  );
}

function Stat({ label, value, onClick, border }: { label: string; value: number; onClick: () => void; border?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={`px-4 py-4 text-left transition hover:bg-white/[0.04] ${border ? "border-l border-white/15" : ""}`}>
      <p className="font-display text-4xl font-bold leading-none tabular-nums text-white">{value}</p>
      <p className="mt-2 text-[9px] font-bold uppercase leading-tight tracking-[0.12em] text-nh-beige/60">{label}</p>
    </button>
  );
}

function FooterCta({ label, onClick, wide }: { label: string; onClick: () => void; wide?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={`bg-nh-beige py-5 text-[11px] font-bold uppercase tracking-[0.14em] text-black transition hover:bg-white ${wide ? "col-span-2" : ""}`}>
      {label}
    </button>
  );
}

/** Tier & saldo XP ringkas → buka tab Progress. */
function TierChip({ onOpen }: { onOpen: () => void }) {
  const [t, setT] = useState<{ name: string; color: string | null; xp: number } | null>(null);
  useEffect(() => {
    memberFetch<{ data: { tier: { name: string; display_color: string | null } | null; xp_balance: number } }>("/api/member-portal/studio/progress")
      .then((r) => setT({ name: r.data.tier?.name ?? "Starter", color: r.data.tier?.display_color ?? null, xp: r.data.xp_balance }))
      .catch(() => setT(null));
  }, []);
  if (!t) return null;
  return (
    <button type="button" onClick={onOpen} className="flex items-center gap-2 rounded-full border border-white/30 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.1em]">
      <span style={{ color: t.color ?? undefined }}>{t.name}</span>
      <span className="text-nh-beige/60">{t.xp.toLocaleString("en-US")} XP</span>
    </button>
  );
}
