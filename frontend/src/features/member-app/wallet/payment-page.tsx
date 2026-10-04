"use client";

import { CheckCircle2, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";
import { ApiError } from "../lib/api";
import type { PaymentView } from "../lib/classes-view";
import { useT } from "../lib/i18n";
import { m } from "../lib/links";
import { simulatePaid, useInvalidateAll, usePayment } from "../lib/queries-classes";
import { Spinner, formatIdr } from "../ui";

const CHANNEL_TITLE: Record<PaymentView["payment"]["channel"], string> = {
  QRIS: "Scan to pay with QRIS",
  ARK_COIN: "Pay with ARK Coin",
};

/** Fallback checkout window when the gateway gives no QR expiry. */
const DEFAULT_WINDOW_SEC = 15 * 60;

/**
 * Checkout for a gym credit package purchase: the QRIS from Xendit (or the
 * local-dev simulated QR), polled until paid. In local dev "I've paid" settles
 * the simulated QR through the same path as the webhook.
 */
export function PaymentPage() {
  const t = useT();
  const { paymentId = "" } = useParams<{ paymentId: string }>();
  const invalidate = useInvalidateAll();
  const { data, refetch } = usePayment(paymentId);
  const [mountedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const pay = async () => {
    if (!data) return;
    setBusy(true);
    setError("");
    try {
      if (data.payment.simulated) {
        await simulatePaid(paymentId);
        invalidate();
      } else {
        const res = await refetch();
        if (res.data?.payment.status === "pending") setError(t("Payment not received yet. Try again in a moment."));
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("Payment failed."));
    } finally {
      setBusy(false);
    }
  };

  if (data?.payment.status === "paid") {
    return (
      <div className="flex flex-col items-center gap-6 pt-10 text-center">
        <CheckCircle2 size={72} className="text-nh-ok" />
        <div>
          <h1 className="nh-display text-3xl font-black">{t("Payment successful")}</h1>
          <p className="mt-1 text-nh-muted">
            {data.payment.credits} {t("credits added")} · {formatIdr(data.payment.totalIdr)}
          </p>
        </div>
        <Link href={m("/wallet")} className="nh-btn-brand w-full">
          {t("Back to wallet")}
        </Link>
        <Link href={m("/classes")} className="text-sm font-bold text-nh-forest">
          {t("Book a class")} →
        </Link>
      </div>
    );
  }

  if (!data) return <Spinner label={t("Preparing checkout…")} />;
  const { payment, packageName } = data;

  if (payment.status !== "pending") {
    return (
      <div className="flex flex-col gap-4 pt-10 text-center">
        <h1 className="nh-display text-3xl font-black">
          {payment.status === "expired" ? t("Checkout expired") : t("Payment failed.")}
        </h1>
        <p className="text-nh-muted">{t("No credits were added. Start a new top up to try again.")}</p>
        <Link href={m("/wallet/topup")} className="nh-btn-brand w-full">
          {t("Top up credits")}
        </Link>
        <Link href={m("/wallet")} className="text-sm font-bold text-nh-muted">
          {t("Back to wallet")}
        </Link>
      </div>
    );
  }

  const deadline = payment.expiresAt ? new Date(payment.expiresAt).getTime() : mountedAt + DEFAULT_WINDOW_SEC * 1000;
  const secondsLeft = Math.max(0, Math.floor((deadline - now) / 1000));
  const mm = Math.floor(secondsLeft / 60);
  const ss = String(secondsLeft % 60).padStart(2, "0");

  return (
    <div className="flex flex-col gap-5 pt-2">
      {/* Gateway-style header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] font-extrabold tracking-[0.16em] text-nh-muted uppercase">{t("Secure checkout")}</p>
          <p className="nh-display text-2xl">{t(CHANNEL_TITLE[payment.channel])}</p>
        </div>
        {payment.simulated ? (
          <span className="nh-chip bg-nh-raised text-nh-muted">
            <ShieldCheck size={12} /> {t("Demo mode")}
          </span>
        ) : null}
      </div>

      <div className="nh-card flex items-center justify-between !py-4 text-sm">
        <div>
          <p className="font-extrabold">{packageName}</p>
          <p className="text-nh-muted">
            {payment.credits} {t("credits")}
          </p>
        </div>
        <div className="text-right">
          <p className="nh-display text-xl text-nh-forest">{formatIdr(payment.totalIdr)}</p>
          <p className="text-xs text-nh-muted">
            {t("expires in")} {mm}:{ss}
          </p>
        </div>
      </div>

      {payment.channel === "QRIS" && payment.qrString ? (
        <div className="nh-card flex flex-col items-center gap-3 !p-6">
          <div className="rounded-2xl bg-white p-4 shadow-[0_1px_2px_rgb(0_0_0/0.06)]">
            <QRCodeSVG value={payment.qrString} size={190} />
          </div>
          <p className="text-center text-sm text-nh-muted">
            {t("Scan with any banking or e-wallet app that supports QRIS.")}
          </p>
        </div>
      ) : null}

      {error ? <p className="text-sm font-bold text-nh-danger">{error}</p> : null}
      <button className="nh-btn-brand" disabled={busy || secondsLeft === 0} onClick={() => void pay()}>
        {t("I've paid - check status")}
      </button>
      {payment.simulated ? (
        <p className="text-center text-xs text-nh-muted">
          {t("Demo checkout - no real money moves. Xendit replaces this screen in production.")}
        </p>
      ) : null}
      <Link href={m("/wallet")} className="text-center text-sm font-bold text-nh-muted">
        {t("Cancel and go back")}
      </Link>
    </div>
  );
}
