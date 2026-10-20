"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { WAIVER_VERSION } from "@/lib/member-app/home";
import { ApiError, memberApi } from "../lib/api";
import { useT } from "../lib/i18n";
import { useAccount, useInvalidateAll } from "../lib/queries-home";
import { Spinner, formatDay } from "../ui";

/**
 * Waiver digital: member membaca dan menyetujui versi yang berlaku. Booking
 * kelas dan masuk gate membutuhkannya bila aturan gym mewajibkan waiver.
 */
export function WaiverPage() {
  const t = useT();
  const router = useRouter();
  const invalidate = useInvalidateAll();
  const { data: me } = useAccount();
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!me) return <Spinner label={t("Loading profile…")} />;

  const { waiverVersion, waiverAcceptedAt } = me.member;
  const current = waiverAcceptedAt !== null && waiverVersion === WAIVER_VERSION;

  const accept = async () => {
    setBusy(true);
    setError("");
    try {
      await memberApi("/app/home/me", { method: "PATCH", json: { acceptWaiver: true } });
      invalidate();
      router.back();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("Save failed."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <button onClick={() => router.back()} className="flex items-center gap-1 text-sm font-bold text-nh-muted">
        <ArrowLeft size={16} /> {t("Back")}
      </button>
      <h1 className="nh-display text-3xl">{t("Digital waiver")}</h1>
      <div className="nh-card text-sm leading-relaxed text-nh-muted">
        <p className="mb-2 font-black text-nh-ink uppercase">{t("Digital waiver (v{v})", { v: WAIVER_VERSION })}</p>
        <p>
          {t(
            "I acknowledge that HYROX-style functional training involves inherent physical risks. I confirm I am medically fit to participate, and I release NüHabit, its staff and coaches from liability for injuries sustained during training, except in cases of gross negligence. I consent to the studio storing my membership and attendance data for operating the facility."
          )}
        </p>
      </div>
      {current ? (
        <p className="nh-card text-sm font-bold text-nh-ok">
          {t("Signed {date}", { date: formatDay(waiverAcceptedAt) })}
        </p>
      ) : (
        <>
          {waiverAcceptedAt ? (
            <p className="text-sm font-bold text-nh-warn">
              {t("You signed version {v}. Sign the new version to keep booking classes.", { v: waiverVersion ?? "-" })}
            </p>
          ) : (
            <p className="text-sm text-nh-muted">{t("Sign the waiver to book classes and enter the gym.")}</p>
          )}
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-0.5 h-5 w-5 accent-[var(--color-nh-forest)]"
            />
            {t("I have read and accept the digital waiver.")}
          </label>
          {error ? <p className="text-sm font-bold text-nh-danger">{error}</p> : null}
          <button className="nh-btn-brand" disabled={busy || !agreed} onClick={() => void accept()}>
            {t("Sign waiver")}
          </button>
        </>
      )}
    </div>
  );
}
