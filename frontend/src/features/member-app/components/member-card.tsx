"use client";

import { X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";
import { useT } from "../lib/i18n";
import { asset } from "../lib/links";
import { useAccount, useMemberQr } from "../lib/queries-home";

/** Kartu member digital layar penuh dengan QR gate yang hidup. */
export function MemberCardSheet({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { data: me } = useAccount();
  const qr = useMemberQr();

  const [secondsLeft, setSecondsLeft] = useState(0);
  useEffect(() => {
    if (!qr.data) return;
    const expiresAt = new Date(qr.data.expiresAt).getTime();
    const tick = () => setSecondsLeft(Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [qr.data]);

  if (!me) return null;
  const m = me.member;
  const memberNo = `NO. ${m.id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;

  return (
    <div
      className="nh-sheet-backdrop fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-5 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="nh-sheet-panel w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <div className="nh-surface-ink relative overflow-hidden rounded-3xl p-6 text-white shadow-[0_30px_80px_rgb(0_0_0/0.5)]">
          <div className="pointer-events-none absolute -top-28 -right-20 h-64 w-64 rounded-full bg-nh-lime/25 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-24 -left-16 h-48 w-48 rounded-full bg-white/[0.05] blur-2xl" />

          <div className="relative flex items-start justify-between">
            <div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={asset("/brand/wordmark-white.png")} alt="NüHabit" className="h-5 w-auto" />
              <p className="mt-1.5 text-[10px] font-bold tracking-[0.24em] text-white/40 uppercase">
                {t("Member card")}
              </p>
            </div>
            <span className={`nh-chip ${m.status === "ACTIVE" ? "bg-nh-ok/20 text-nh-ok" : "bg-white/10 text-white/70"}`}>
              {t(m.status)}
            </span>
          </div>

          <div className="relative mt-6 flex items-center justify-center">
            <div className="rounded-2xl bg-white p-3.5">
              {qr.data ? (
                <QRCodeSVG value={qr.data.token} size={168} level="M" marginSize={0} />
              ) : (
                <div className="h-[168px] w-[168px]" />
              )}
            </div>
          </div>
          <p className="relative mt-2 text-center text-[11px] font-bold text-white/40">
            {t("Scan at the gate · refreshes in {n}s", { n: secondsLeft })}
          </p>

          <div className="relative mt-6 flex items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="nh-display truncate text-xl leading-tight">{m.fullName}</p>
              <p className="mt-0.5 font-mono text-[11px] tracking-[0.18em] text-white/45">{memberNo}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-[10px] font-bold tracking-[0.18em] text-white/40 uppercase">{t("Credits")}</p>
              <p className="nh-display text-2xl leading-none text-nh-lime">{me.balance}</p>
            </div>
          </div>
        </div>

        <button
          onClick={onClose}
          className="mx-auto mt-5 flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white"
          aria-label={t("Close")}
        >
          <X size={18} />
        </button>
      </div>
    </div>
  );
}
