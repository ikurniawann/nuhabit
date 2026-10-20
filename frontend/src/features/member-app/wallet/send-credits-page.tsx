"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError } from "../lib/api";
import { useT } from "../lib/i18n";
import { m } from "../lib/links";
import { useSendCredits, useWallet } from "../lib/queries-classes";
import { Spinner } from "../ui";

/** Wallet → send credits to another member by phone number. */
export function SendCreditsPage() {
  const t = useT();
  const router = useRouter();
  const { data: wallet, isLoading } = useWallet();
  const send = useSendCredits();
  const [phone, setPhone] = useState("");
  const [credits, setCredits] = useState("");
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [sent, setSent] = useState<number | null>(null);
  const [key] = useState(() => crypto.randomUUID());

  if (isLoading || !wallet) return <Spinner label={t("Loading wallet…")} />;

  const amount = Number(credits);
  const limit = Math.min(wallet.balance, wallet.transfer.leftThisMonth ?? wallet.balance);
  const valid = phone.replace(/\D/g, "").length >= 9 && Number.isInteger(amount) && amount >= 1 && amount <= limit;
  const error = send.error instanceof ApiError ? send.error.message : send.error ? t("Could not send the credits.") : "";

  const back = (
    <button onClick={() => router.back()} className="flex items-center gap-1 text-sm font-bold text-nh-muted">
      <ArrowLeft size={16} /> {t("Back")}
    </button>
  );

  if (!wallet.transfer.enabled) {
    return (
      <div className="flex flex-col gap-5">
        {back}
        <h1 className="nh-display text-3xl font-black">{t("Send credits")}</h1>
        <p className="text-sm text-nh-muted">{t("Sending credits is not available at your gym.")}</p>
      </div>
    );
  }

  if (sent != null) {
    return (
      <div className="flex flex-col gap-5">
        <h1 className="nh-display text-3xl font-black">{t("Credits sent")}</h1>
        <p className="text-sm text-nh-muted">{t("{n} credits are on their way. You both get a notification.", { n: sent })}</p>
        <Link href={m("/wallet")} className="nh-btn-brand">
          {t("Back to wallet")}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {back}
      <h1 className="nh-display text-3xl font-black">{t("Send credits")}</h1>
      <p className="text-sm text-nh-muted">
        {t("Credits keep their expiry date and the classes they are valid for.")}
        {wallet.transfer.leftThisMonth != null ? ` ${t("You can send {n} more this month.", { n: wallet.transfer.leftThisMonth })}` : ""}
      </p>

      <div>
        <label className="nh-label" htmlFor="send-phone">
          {t("Recipient phone number")}
        </label>
        <input
          id="send-phone"
          className="nh-input w-full"
          inputMode="tel"
          value={phone}
          disabled={confirming}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="0812 3456 7890"
        />
      </div>
      <div>
        <label className="nh-label" htmlFor="send-credits">
          {t("Credits")}
        </label>
        <input
          id="send-credits"
          className="nh-input w-full"
          type="number"
          inputMode="numeric"
          min={1}
          max={limit}
          value={credits}
          disabled={confirming}
          onChange={(e) => setCredits(e.target.value)}
        />
        <p className="mt-1 text-xs text-nh-muted">{t("Balance: {n} credits", { n: wallet.balance })}</p>
      </div>
      <div>
        <label className="nh-label" htmlFor="send-note">
          {t("Message (optional)")}
        </label>
        <input
          id="send-note"
          className="nh-input w-full"
          maxLength={200}
          value={note}
          disabled={confirming}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      {error ? <p className="text-sm font-bold text-nh-danger">{error}</p> : null}
      {confirming ? (
        <div className="nh-card flex flex-col gap-3">
          <p className="text-sm">{t("Send {n} credits to {phone}? This cannot be undone.", { n: amount, phone })}</p>
          <div className="grid grid-cols-2 gap-2">
            <button className="nh-btn-ghost" disabled={send.isPending} onClick={() => setConfirming(false)}>
              {t("Cancel")}
            </button>
            <button
              className="nh-btn-brand"
              disabled={send.isPending}
              onClick={() =>
                send.mutate(
                  { phone, credits: amount, note: note.trim(), idempotencyKey: key },
                  { onSuccess: (res) => setSent(res.credits), onError: () => setConfirming(false) }
                )
              }
            >
              {send.isPending ? t("Sending…") : t("Confirm")}
            </button>
          </div>
        </div>
      ) : (
        <button className="nh-btn-brand" disabled={!valid} onClick={() => setConfirming(true)}>
          {t("Continue")}
        </button>
      )}
    </div>
  );
}
