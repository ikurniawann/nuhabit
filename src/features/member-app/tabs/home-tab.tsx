"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { ArrowRight, CalendarDays, Dumbbell, Flame } from "lucide-react";
import { useMember } from "../member-app";
import { type CoachProfile, firstName, friendlyDay, jam, memberFetch, wibToday } from "../lib";
import { Avatar, Card, CenterSpinner, PillButton, SectionTitle, Tag } from "../ui";
import { BookingRow } from "./booking-row";
import { NewsSection } from "./news-section";

export function HomeTab() {
  const { profile, passes, bookings, go } = useMember();
  const [coaches, setCoaches] = useState<CoachProfile[] | null>(null);

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
  const classTotal = active.reduce((s, p) => s + p.class_credits_total, 0);
  const soonest = active.map((p) => p.valid_until).sort()[0];

  // Streak sederhana: jumlah sesi hadir dalam 7 hari terakhir.
  const weekAgo = new Date(Date.now() + 7 * 3600e3 - 7 * 86400e3).toISOString().slice(0, 10);
  const attendedThisWeek = (bookings ?? []).filter((b) => b.status === "attended" && b.session_date >= weekAgo && b.session_date <= wibToday()).length;

  if (!passes || !bookings) return <CenterSpinner />;

  return (
    <div className="space-y-7 pt-2">
      <section>
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-nh-beige/60">Halo, {firstName(profile.name)}</p>
          <TierChip onOpen={() => go("profile")} />
        </div>
        <h1 className="font-display text-3xl font-bold uppercase leading-tight tracking-tight">
          {next ? "Sesi berikutnya menunggu." : "Mulai dari satu sesi."}
        </h1>
      </section>

      {next ? (
        <div className="relative overflow-hidden rounded-[2rem] bg-nh-forest p-5">
          <Image src="/brand/wallpaper-forest.webp" alt="" fill className="object-cover opacity-40" />
          <div className="relative">
            <div className="flex items-center justify-between">
              <Tag tone="lime">{next.status === "waitlisted" ? "Waitlist" : "Terkunci"}</Tag>
              <span className="text-xs text-nh-beige/70">{friendlyDay(next.session_date)}</span>
            </div>
            <p className="mt-4 font-display text-5xl font-bold tabular-nums text-nh-lime">{jam(next.start_time)}</p>
            <p className="mt-1 font-display text-xl font-semibold">{next.program_name}</p>
            <p className="text-sm text-nh-beige/70">{next.coach_name ? `bersama ${next.coach_name}` : ""}</p>
            {upcoming.length > 1 && <p className="mt-3 text-xs text-nh-beige/60">+{upcoming.length - 1} sesi lain sudah dibooking</p>}
          </div>
        </div>
      ) : (
        <div className="relative overflow-hidden rounded-[2rem] bg-nh-forest p-6">
          <Image src="/brand/wallpaper-forest.webp" alt="" fill className="object-cover opacity-40" />
          <div className="relative">
            <p className="font-display text-xl font-semibold">Belum ada sesi.</p>
            <p className="mt-1 text-sm text-nh-beige/70">Pilih kelas minggu ini dan kunci tempatmu.</p>
            <PillButton className="mt-5" onClick={() => go("schedule")}>
              Booking kelas <ArrowRight className="size-4" />
            </PillButton>
          </div>
        </div>
      )}

      <section className="grid grid-cols-2 gap-3">
        <Card onClick={() => go("passes")}>
          <p className="text-xs text-nh-beige/60">Sisa kelas</p>
          <p className="mt-1 font-display text-3xl font-bold tabular-nums">{classLeft}</p>
          {classTotal > 0 && (
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-nh-lime" style={{ width: `${Math.min(100, (classLeft / classTotal) * 100)}%` }} />
            </div>
          )}
          <p className="mt-2 text-[11px] text-nh-beige/50">{soonest ? `Aktif s/d ${friendlyDay(soonest)}` : "Belum ada paket aktif"}</p>
        </Card>
        <Card onClick={() => go("pt")}>
          <p className="text-xs text-nh-beige/60">Sisa Personal Training</p>
          <p className="mt-1 font-display text-3xl font-bold tabular-nums">{ptLeft}</p>
          <p className="mt-2 flex items-center gap-1 text-[11px] text-nh-beige/50">
            <Flame className="size-3.5 text-nh-lime" /> {attendedThisWeek} sesi minggu ini
          </p>
        </Card>
      </section>

      {active.length > 0 && classLeft + ptLeft <= 1 && (
        <Card className="border-nh-lime/30">
          <p className="font-semibold">Tinggal {classLeft + ptLeft} sesi lagi.</p>
          <p className="mt-1 text-sm text-nh-beige/60">Lanjutkan kebiasaanmu?</p>
          <PillButton className="mt-3" onClick={() => go("passes")}>Lihat paket</PillButton>
        </Card>
      )}

      <section className="grid grid-cols-2 gap-3">
        <PillButton onClick={() => go("schedule")}>
          <CalendarDays className="size-4" /> Booking kelas
        </PillButton>
        <PillButton variant="ghost" onClick={() => go("pt")}>
          <Dumbbell className="size-4" /> Personal Training
        </PillButton>
      </section>

      {upcoming.length > 0 && (
        <section>
          <SectionTitle>Booking saya</SectionTitle>
          <div className="space-y-2">
            {upcoming.slice(0, 5).map((b) => (
              <BookingRow key={b.id} booking={b} />
            ))}
          </div>
        </section>
      )}

      <NewsSection />

      <section>
        <SectionTitle
          action={
            <button type="button" onClick={() => go("profile")} className="text-xs font-semibold text-nh-lime">
              Semua
            </button>
          }
        >
          Coach kami
        </SectionTitle>
        {!coaches ? (
          <CenterSpinner />
        ) : coaches.length === 0 ? (
          <p className="text-sm text-nh-beige/50">Profil coach segera hadir.</p>
        ) : (
          <div className="-mx-5 flex gap-3 overflow-x-auto px-5 pb-1">
            {coaches.map((c) => (
              <button key={c.id} type="button" onClick={() => go("profile")} className="w-28 shrink-0 text-center">
                <span className="mx-auto block w-fit rounded-full ring-2 ring-nh-lime/30">
                  <Avatar name={c.name} photo={c.photo_url} size={72} />
                </span>
                <p className="mt-2 truncate text-sm font-semibold">{c.name}</p>
                <p className="text-[11px] text-nh-beige/50">{c.level === "head_coach" ? "Head Coach" : "Coach"}</p>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/** Tier & saldo XP ringkas di beranda → buka tab Progres. */
function TierChip({ onOpen }: { onOpen: () => void }) {
  const [t, setT] = useState<{ name: string; color: string | null; xp: number } | null>(null);
  useEffect(() => {
    memberFetch<{ data: { tier: { name: string; display_color: string | null } | null; xp_balance: number } }>("/api/member-portal/studio/progress")
      .then((r) => setT({ name: r.data.tier?.name ?? "Starter", color: r.data.tier?.display_color ?? null, xp: r.data.xp_balance }))
      .catch(() => setT(null));
  }, []);
  if (!t) return null;
  return (
    <button type="button" onClick={onOpen} className="flex items-center gap-2 rounded-full border border-white/15 px-3 py-1 text-xs">
      <span className="font-semibold" style={{ color: t.color ?? undefined }}>{t.name}</span>
      <span className="text-nh-beige/60">{t.xp.toLocaleString("id-ID")} XP</span>
    </button>
  );
}
