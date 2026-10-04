"use client";

import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";
import { CHECKIN_EARLY_MIN } from "@/lib/gym/booking";
import { pickGateBooking } from "@/lib/member-app/home";
import { useT } from "../lib/i18n";
import { m } from "../lib/links";
import { useAccount, useMemberQr, useMyBookings } from "../lib/queries-home";
import { Spinner, formatDayTime, formatTime } from "../ui";

const R = 26;
const CIRC = 2 * Math.PI * R;

export function QrPage() {
  const t = useT();
  const { data: me } = useAccount();
  const { data: bookings } = useMyBookings();
  // Token pendek yang baru, diterbitkan ulang otomatis begitu kedaluwarsa.
  const qr = useMemberQr();

  const [secondsLeft, setSecondsLeft] = useState(0);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!qr.data) return;
    const expiresAt = new Date(qr.data.expiresAt).getTime();
    const tick = () => {
      const at = Date.now();
      setNow(at);
      setSecondsLeft(Math.max(0, Math.ceil((expiresAt - at) / 1000)));
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [qr.data]);

  if (!qr.data) return <Spinner label={t("Generating your code…")} />;

  const fraction = qr.data.ttlSeconds > 0 ? secondsLeft / qr.data.ttlSeconds : 0;
  const gate = bookings ? pickGateBooking(bookings, now) : null;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="nh-display text-3xl">{t("Gate access")}</h1>
        <p className="mt-1 text-sm text-nh-muted">{t("Show this at the scanner to check in to your booked class.")}</p>
      </div>

      <div className="nh-card nh-surface-ink relative overflow-hidden !border-0 !p-6 text-white">
        <div className="pointer-events-none absolute -top-28 -right-20 h-64 w-64 rounded-full bg-nh-lime/25 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -left-16 h-48 w-48 rounded-full bg-white/[0.05] blur-2xl" />

        <div className="relative mx-auto w-fit rounded-2xl bg-white p-4">
          <QRCodeSVG value={qr.data.token} size={212} level="M" marginSize={0} />
        </div>

        <div className="relative mt-6 flex items-center gap-4">
          <svg width="56" height="56" viewBox="0 0 64 64" aria-hidden className="shrink-0">
            <circle cx="32" cy="32" r={R} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="5" />
            <circle
              cx="32"
              cy="32"
              r={R}
              fill="none"
              stroke="#daff59"
              strokeWidth="5"
              strokeLinecap="round"
              strokeDasharray={CIRC}
              strokeDashoffset={CIRC * (1 - fraction)}
              transform="rotate(-90 32 32)"
              style={{ transition: "stroke-dashoffset 0.25s linear" }}
            />
            <text x="32" y="37" textAnchor="middle" fill="#ffffff" fontSize="16" fontWeight="800" fontFamily="inherit">
              {secondsLeft}
            </text>
          </svg>
          <div className="min-w-0 flex-1 text-sm text-white/55">
            <p className="truncate font-extrabold text-white">{me?.member.fullName}</p>
            <p className="text-xs">{t("Refreshes automatically every {n}s.", { n: qr.data.ttlSeconds })}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[10px] font-bold tracking-[0.18em] text-white/40 uppercase">{t("Credits")}</p>
            <p className="nh-display text-2xl leading-none text-nh-lime">{me?.balance ?? "…"}</p>
          </div>
        </div>

        <div className="relative mt-5 flex items-center justify-between border-t border-white/10 pt-4">
          <Link href={m("/visits")} className="nh-chip bg-white/10 text-white/80">
            {t("Visit history →")}
          </Link>
          <Link href={m("/wallet/topup")} className="nh-chip bg-white/10 text-white/80">
            {t("Top up")}
          </Link>
        </div>
      </div>

      {/* Masuk selalu terikat kelas yang dipesan - tidak ada open gym. */}
      {gate ? (
        <Link href={m(`/classes/${gate.booking.session.id}`)} className="nh-card flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold tracking-[0.18em] text-nh-muted uppercase">
              {gate.live ? t("Check in now") : t("Next class")}
            </p>
            <p className="truncate font-black">{gate.booking.classTypeName}</p>
            <p className="truncate text-sm text-nh-muted">
              {formatDayTime(gate.booking.session.startsAt)} – {formatTime(gate.booking.session.endsAt)} ·{" "}
              {gate.booking.branchName}
            </p>
            <p className="mt-1 text-xs text-nh-muted">
              {gate.live
                ? gate.booking.booking.status === "CHECKED_IN"
                  ? t("You are checked in - scan again within the grace window for free re-entry.")
                  : t(
                      gate.booking.session.creditCost === 1
                        ? "Scan at a {branch} gate to check in ({n} credit)."
                        : "Scan at a {branch} gate to check in ({n} credits).",
                      { branch: gate.booking.branchName, n: gate.booking.session.creditCost }
                    )
                : t("The gate opens from {n} minutes before your class starts.", { n: CHECKIN_EARLY_MIN })}
            </p>
          </div>
          <span className={`nh-chip shrink-0 ${gate.live ? "bg-nh-ok/15 text-nh-ok" : "bg-nh-raised text-nh-muted"}`}>
            {gate.live ? t("Live") : t("Booked")}
          </span>
        </Link>
      ) : (
        <div className="nh-card">
          <p className="text-[10px] font-bold tracking-[0.18em] text-nh-muted uppercase">{t("No class booked")}</p>
          <p className="mt-1 text-sm text-nh-muted">
            {t(
              "Entry requires a booked class - the gate denies a scan without one. Book a session first, then scan from {n} minutes before it starts.",
              { n: CHECKIN_EARLY_MIN }
            )}
          </p>
          <Link href={m("/classes")} className="nh-btn-brand mt-3 w-full !py-2 text-sm">
            {t("Browse classes")}
          </Link>
        </div>
      )}
    </div>
  );
}
