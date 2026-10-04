"use client";

import { CheckCircle2, Clock } from "lucide-react";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";
import { formatRp } from "@/lib/member-app/loyalty";
import { ApiError } from "../lib/api";
import { useT } from "../lib/i18n";
import { m } from "../lib/links";
import { loyaltyKeys, simulateArkTopupPaid, useArkTopup, useRefresh } from "../lib/queries-loyalty";
import { Spinner } from "../ui";
import { Notice } from "./loyalty-ui";

function useSecondsLeft(expiresAt: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  return expiresAt ? Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 1000)) : 0;
}

/** QRIS top-up ARK yang dipantau sampai lunas; saldo masuk lewat webhook (atau simulasi di dev). */
export function ArkTopupPayment({
  topupId,
  canSimulate,
  onDone,
}: {
  topupId: string;
  canSimulate: boolean;
  onDone: () => void;
}) {
  const t = useT();
  const refresh = useRefresh();
  const { data: topup, isLoading, error: loadError, refetch } = useArkTopup(topupId);
  const secondsLeft = useSecondsLeft(topup?.expires_at ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const paid = topup?.status === "completed";

  useEffect(() => {
    if (paid) void refresh(loyaltyKeys.me, loyaltyKeys.transactions, loyaltyKeys.topupOptions);
  }, [paid, refresh]);

  if (isLoading) return <Spinner label={t("Preparing checkout…")} />;
  if (!topup) {
    return <Notice ok={false}>{loadError instanceof Error ? loadError.message : t("Top-up not found")}</Notice>;
  }

  if (paid) {
    return (
      <div className="flex flex-col gap-5">
        <div className="nh-card nh-surface-brand !border-0 !p-6 text-nh-ink">
          <CheckCircle2 size={36} strokeWidth={2.4} />
          <p className="nh-display mt-3 text-3xl font-black">{t("Balance added")}</p>
          <p className="nh-display mt-1 text-5xl tabular-nums">+{formatRp(topup.credit_idr)}</p>
          <p className="mt-3 text-sm font-semibold">
            {t("Balance now {amount}", { amount: formatRp(topup.balance_after) })}
          </p>
        </div>
        <Link href={m("/coins")} className="nh-btn-brand">
          {t("Back to ARK Coin")}
        </Link>
        <button type="button" className="nh-btn-ghost" onClick={onDone}>
          {t("Top up again")}
        </button>
      </div>
    );
  }

  const expired = topup.status !== "pending" || (topup.expires_at !== null && secondsLeft === 0);
  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const ss = String(secondsLeft % 60).padStart(2, "0");

  const simulate = async () => {
    setBusy(true);
    setError("");
    try {
      await simulateArkTopupPaid(topupId);
      await refetch();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("Payment failed."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="text-[11px] font-extrabold tracking-[0.16em] text-nh-muted uppercase">{t("Secure checkout")}</p>
        <h1 className="nh-display text-3xl font-black">{t("Pay with QRIS")}</h1>
        <p className="mt-1 text-sm text-nh-muted">
          {topup.package_name ? `${topup.package_name} · ` : ""}
          {t("Scan with any banking or e-wallet app that supports QRIS.")}
        </p>
      </div>

      <div className="nh-card flex flex-col items-center gap-3 !p-6">
        <p className="nh-display text-4xl tabular-nums">{formatRp(topup.amount)}</p>
        {topup.credit_idr > topup.amount ? (
          <span className="nh-chip bg-nh-lime text-nh-ink">
            {t("You receive {amount}", { amount: formatRp(topup.credit_idr) })}
          </span>
        ) : null}
        <div className={`rounded-2xl bg-white p-4 ${expired ? "opacity-30" : ""}`}>
          {topup.qr_string ? (
            <QRCodeSVG value={topup.qr_string} size={220} level="M" marginSize={0} />
          ) : (
            <div className="flex h-[220px] w-[220px] items-center justify-center text-xs text-nh-muted">
              {t("QR unavailable")}
            </div>
          )}
        </div>
        {expired ? (
          <p className="text-center text-sm font-bold text-nh-danger">
            {t("This QR has expired. Create a new one to pay.")}
          </p>
        ) : (
          <p className="inline-flex items-center gap-1.5 text-sm font-bold text-nh-muted">
            <Clock size={15} /> {t("Waiting for payment")} · {mm}:{ss}
          </p>
        )}
        {topup.simulated ? (
          <p className="text-center text-xs text-nh-muted">{t("Local test mode: this is not a real QRIS.")}</p>
        ) : null}
      </div>

      {canSimulate && !expired ? (
        <button type="button" className="nh-btn-ghost" disabled={busy} onClick={() => void simulate()}>
          {t("Simulate payment (dev)")}
        </button>
      ) : null}
      {error ? <Notice ok={false}>{error}</Notice> : null}

      <button type="button" className={expired ? "nh-btn-brand" : "nh-btn-ghost"} onClick={onDone}>
        {expired ? t("Create a new QR") : t("Choose another amount")}
      </button>
    </div>
  );
}
