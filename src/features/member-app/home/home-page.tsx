"use client";

import { BookMarked, CalendarDays, CirclePlay, Dumbbell, Flag, QrCode } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { goLinkHref } from "@/lib/member-app/go-link";
import { MemberCardSheet } from "../components/member-card";
import { useT } from "../lib/i18n";
import { classImage } from "../lib/images";
import { asset, m } from "../lib/links";
import { useAccount, useHomeFeed, useMyBookings, usePromos } from "../lib/queries-home";
import { Spinner, formatDay, formatDayTime, formatDuration, formatTime } from "../ui";

/** Header seksi yang tenang: label huruf kapital kecil + tautan opsional. */
function SectionHeader({ label, action }: { label: string; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between px-1">
      <p className="text-[11px] font-extrabold tracking-[0.16em] text-nh-muted uppercase">{label}</p>
      {action}
    </div>
  );
}

/** Notifikasi & push membuka /member?go=<tujuan>; teruskan sekali ke rute aplikasi. */
function useGoRedirect() {
  const router = useRouter();
  useEffect(() => {
    const href = goLinkHref(new URLSearchParams(window.location.search).get("go"));
    if (href) router.replace(href);
  }, [router]);
}

export function HomePage() {
  const t = useT();
  useGoRedirect();
  const { data: me, isLoading } = useAccount();
  const { data: bookings } = useMyBookings();
  const { data: home } = useHomeFeed();
  const { data: promos } = usePromos();
  const [cardOpen, setCardOpen] = useState(false);
  const [now] = useState(Date.now);

  if (isLoading || !me) return <Spinner label={t("Loading…")} />;

  const upcoming = (bookings ?? [])
    .filter(
      (b) =>
        ["CONFIRMED", "WAITLIST"].includes(b.booking.status) && new Date(b.session.startsAt).getTime() > now
    )
    .slice(0, 3);

  return (
    <div className="flex flex-col gap-8 pt-2">
      <div>
        <p className="text-sm font-semibold text-nh-muted">{t("Hey,")}</p>
        <p className="nh-display text-3xl leading-tight">{me.member.fullName.split(" ")[0]}</p>
      </div>

      {/* Saldo kredit - "kartu hitam"; ketuk membuka kartu member digital */}
      <button
        onClick={() => setCardOpen(true)}
        className="nh-card nh-surface-ink relative block w-full overflow-hidden !border-0 !p-6 text-left text-white"
      >
        <div className="pointer-events-none absolute -top-24 -right-16 h-56 w-56 rounded-full bg-nh-lime/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-28 -left-10 h-48 w-48 rounded-full bg-white/[0.04] blur-2xl" />
        <div className="relative flex items-start justify-between">
          <div>
            <p className="text-[10px] font-bold tracking-[0.22em] text-white/50 uppercase">{t("Credit balance")}</p>
            <p className="nh-display mt-1 text-7xl leading-none">{me.balance}</p>
          </div>
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10">
            <QrCode size={22} className="text-white/80" />
          </span>
        </div>
        <div className="relative mt-5 flex items-center justify-between">
          <p className="text-xs font-semibold text-white/45">{me.member.fullName}</p>
          <Link
            href={m(me.lowBalance ? "/wallet/topup" : "/wallet")}
            onClick={(e) => e.stopPropagation()}
            className={`nh-chip ${me.lowBalance ? "bg-nh-lime text-nh-ink" : "bg-white/10 text-white/80"}`}
          >
            {me.lowBalance
              ? t("Top up")
              : me.expiringCredits > 0
                ? `${me.expiringCredits} ${t("expiring soon")}`
                : t("Wallet")}
          </Link>
        </div>
      </button>

      {/* Aksi cepat - masing-masing dengan rona aksen sendiri */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { to: "/qr", icon: QrCode, label: t("Check in"), tint: "nh-surface-brand text-nh-ink" },
          { to: "/classes", icon: CalendarDays, label: t("Book a class"), tint: "bg-nh-ink-soft text-white" },
          { to: "/my-classes", icon: BookMarked, label: t("My classes"), tint: "bg-nh-ink-soft text-white" },
          { to: "/workout", icon: Dumbbell, label: t("Generate workout"), tint: "bg-nh-ink-soft text-white" },
          { to: "/races", icon: Flag, label: t("Races"), tint: "bg-nh-ink-soft text-white" },
          { to: "/train/tutorials", icon: CirclePlay, label: t("Guides"), tint: "bg-nh-ink-soft text-white" },
        ].map(({ to, icon: Icon, label, tint }) => (
          <Link key={to} href={m(to)} className="nh-card flex items-center gap-3 !p-4 active:scale-[0.98]">
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tint}`}>
              <Icon size={19} strokeWidth={2.2} />
            </span>
            <span className="text-sm leading-tight font-bold">{label}</span>
          </Link>
        ))}
      </div>

      {/* Sorotan race - kartu foto */}
      {home?.spotlightRace ? (
        <Link
          href={m(`/races/${home.spotlightRace.raceEventId}`)}
          className="nh-card relative block overflow-hidden !border-0 !p-0 text-white"
        >
          {home.spotlightRace.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={home.spotlightRace.imageUrl} alt="" className="h-52 w-full object-cover" loading="lazy" />
          ) : (
            <div className="nh-surface-brand h-52 w-full" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-black/5" />
          <div className="absolute inset-x-0 bottom-0 p-6">
            <p className="text-[10px] font-bold tracking-[0.22em] text-white/60 uppercase">
              {home.spotlightRace.joined ? t("Race day") : t("Next race near you")} ·{" "}
              {formatDay(home.spotlightRace.startsAt)}
            </p>
            <p className="nh-display mt-0.5 text-3xl leading-tight">{home.spotlightRace.name}</p>
            <div className="mt-3 flex items-center gap-2">
              <span className="nh-chip bg-white/15 text-white backdrop-blur">
                {home.spotlightRace.daysToRace} {t("days away")}
              </span>
              {home.spotlightRace.joined && home.spotlightRace.goalSec ? (
                <span className="nh-chip bg-white/15 text-white backdrop-blur">
                  {t("Goal")} {formatDuration(home.spotlightRace.goalSec)}
                </span>
              ) : !home.spotlightRace.joined ? (
                <span className="nh-chip bg-nh-lime text-nh-ink">{t("Add to my races")}</span>
              ) : null}
            </div>
          </div>
        </Link>
      ) : null}

      {/* Promo */}
      {promos && promos.length > 0 ? (
        <section>
          <SectionHeader label={t("Promos")} />
          <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1">
            {promos.map((p) => (
              <Link
                key={p.code}
                href={m(`/promos/${encodeURIComponent(p.code)}`)}
                className="nh-card nh-surface-ink relative min-w-64 shrink-0 snap-start overflow-hidden !border-0 text-white"
              >
                <div className="pointer-events-none absolute -top-16 -right-12 h-40 w-40 rounded-full bg-nh-lime/15 blur-3xl" />
                <div className="relative flex items-start justify-between gap-2">
                  <p className="nh-display text-3xl leading-none">{p.label}</p>
                  <span className="rounded-full bg-white/10 px-2.5 py-1 font-mono text-[11px] font-bold tracking-wider text-white/80">
                    {p.code}
                  </span>
                </div>
                <p className="relative mt-2 text-sm font-medium text-white/60">{p.description}</p>
                <div className="relative mt-4 flex items-center justify-between text-xs">
                  <span className="font-semibold text-white/40">
                    {p.endsAt ? `${t("Until")} ${formatDay(p.endsAt)}` : t("No end date")}
                  </span>
                  <span className="nh-chip bg-nh-lime text-nh-ink">{t("Use it")}</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {/* Pengumuman - satu kartu tenang, baris dipisah garis tipis */}
      {home && home.announcements.length > 0 ? (
        <section>
          <SectionHeader label={t("Announcements")} />
          <div className="nh-card divide-y divide-nh-line !py-1">
            {home.announcements.map((a, i) => (
              <Link key={a.id} href={m(`/announcements/${a.id}`)} className="block py-3.5">
                <div className="flex gap-3">
                  <span
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${i === 0 ? "bg-nh-forest" : "bg-nh-ink/25"}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="text-sm font-extrabold">{a.title}</p>
                      <p className="shrink-0 text-xs text-nh-muted/70">{formatDay(a.createdAt)}</p>
                    </div>
                    <p className="mt-0.5 text-sm text-nh-muted">{a.message}</p>
                  </div>
                  {a.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={a.imageUrl}
                      alt=""
                      className="h-14 w-14 shrink-0 self-center rounded-xl object-cover"
                      loading="lazy"
                    />
                  ) : null}
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {/* Rel kelas hari ini */}
      {home && home.todaySessions.length > 0 ? (
        <section>
          <SectionHeader
            label={home.railDay === "TODAY" ? t("Today at the studio") : t("Tomorrow at the studio")}
            action={
              <Link href={m("/classes")} className="text-xs font-bold text-nh-ink/50">
                {t("Schedule")} →
              </Link>
            }
          />
          <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1">
            {home.todaySessions.map((v) => {
              const image = classImage(v.classTypeName);
              return (
                <Link
                  key={v.session.id}
                  href={m(`/classes/${v.session.id}`)}
                  className="nh-card min-w-48 shrink-0 snap-start overflow-hidden !p-0"
                >
                  {image ? (
                    <div className="relative h-24 w-full">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={image} alt="" className="h-full w-full object-cover" loading="lazy" />
                      <span className="nh-display absolute bottom-2 left-3 text-xl text-white drop-shadow-[0_1px_4px_rgb(0_0_0/0.6)]">
                        {formatTime(v.session.startsAt)}
                      </span>
                    </div>
                  ) : (
                    <p className="nh-display px-3.5 pt-3 text-xl">{formatTime(v.session.startsAt)}</p>
                  )}
                  <div className="p-3.5 pt-2.5">
                    <p className="truncate text-sm font-extrabold">{v.classTypeName}</p>
                    <p className="truncate text-xs text-nh-muted">
                      {v.branchName} · {v.coachName}
                    </p>
                    <p
                      className={`mt-1.5 text-xs font-bold ${
                        v.myBooking ? "text-nh-ok" : v.spotsLeft > 0 ? "text-nh-forest" : "text-nh-warn"
                      }`}
                    >
                      {v.myBooking ? t("Booked") : v.spotsLeft > 0 ? `${v.spotsLeft} ${t("left")}` : t("Full · WL")}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* Booking mendatang - satu kartu tenang, baris dipisah garis tipis */}
      <section>
        <SectionHeader
          label={t("Upcoming")}
          action={
            <Link href={m("/bookings")} className="text-xs font-bold text-nh-ink/50">
              {t("All bookings")} →
            </Link>
          }
        />
        {upcoming.length === 0 ? (
          <div className="nh-card text-sm text-nh-muted">
            {t("Nothing booked yet.")}{" "}
            <Link href={m("/classes")} className="font-bold text-nh-forest">
              {t("Browse the schedule →")}
            </Link>
          </div>
        ) : (
          <div className="nh-card divide-y divide-nh-line !py-1">
            {upcoming.map((b) => {
              const d = new Date(b.session.startsAt);
              return (
                <Link
                  key={b.booking.id}
                  href={m(`/classes/${b.session.id}`)}
                  className="flex items-center gap-3 py-3.5"
                >
                  <span className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-2xl bg-nh-forest/[0.08]">
                    <span className="nh-display text-lg leading-none text-nh-forest">{d.getDate()}</span>
                    <span className="text-[9px] font-extrabold tracking-wide text-nh-forest/70 uppercase">
                      {d.toLocaleDateString(undefined, { month: "short" })}
                    </span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-extrabold">{b.classTypeName}</p>
                    <p className="truncate text-sm text-nh-muted">
                      {formatDayTime(b.session.startsAt)} · {b.branchName}
                    </p>
                  </div>
                  <span
                    className={`nh-chip shrink-0 ${
                      b.booking.status === "CONFIRMED" ? "bg-nh-ok/10 text-nh-ok" : "bg-nh-warn/10 text-nh-warn"
                    }`}
                  >
                    {b.booking.status === "WAITLIST" ? `WL #${b.booking.waitlistPosition}` : t("Booked")}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* Penutup komunitas - percikan warna merek di akhir halaman */}
      <Link href={m("/train")} className="nh-card nh-surface-brand relative block overflow-hidden !border-0 !p-6 text-nh-ink">
        <div className="pointer-events-none absolute -top-20 -right-14 h-48 w-48 rounded-full bg-white/40 blur-3xl" />
        <p className="text-[10px] font-bold tracking-[0.22em] text-nh-ink/60 uppercase">{t("Community")}</p>
        <p className="nh-display mt-1 text-2xl leading-tight">{t("See what your crew is training")}</p>
        <span className="nh-chip mt-4 bg-nh-ink/10 text-nh-ink backdrop-blur">{t("Open Train")} →</span>
      </Link>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={asset("/brand/wordmark-black.png")}
        alt=""
        aria-hidden
        className="mx-auto mb-2 h-7 w-auto opacity-[0.08]"
      />

      {cardOpen ? <MemberCardSheet onClose={() => setCardOpen(false)} /> : null}
    </div>
  );
}
