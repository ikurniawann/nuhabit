"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { useMemberOtp } from "../lib/use-member-otp";
import { useT } from "../lib/i18n";
import { asset, m } from "../lib/links";
import { GoogleSignIn, type GoogleNeedsPhone } from "./google-sign-in";
import "../member-app.css";

/** Tujuan setelah masuk: `?from=` dari guard aplikasi, hanya path aplikasi member. */
function returnPath(): string {
  const from = new URLSearchParams(window.location.search).get("from");
  return from && from.startsWith("/member") && !from.startsWith("//") ? from : m("/");
}

export function LoginPage() {
  const t = useT();
  const router = useRouter();
  const qc = useQueryClient();
  const onSignedIn = useCallback(() => {
    // Cache 401 dari sesi lama dibuang supaya guard aplikasi memuat ulang.
    qc.clear();
    router.replace(returnPath());
  }, [qc, router]);
  const otp = useMemberOtp({ onSignedIn });
  // Akun Google tanpa member: lengkapi nomor WhatsApp di pendaftaran.
  const onNeedsPhone = useCallback(
    (identity: GoogleNeedsPhone) => router.push(`${m("/auth/register")}?${new URLSearchParams({ ...identity })}`),
    [router]
  );

  const canSubmit = otp.step === "phone" ? otp.phone.trim().length >= 6 : otp.code.length === 6;

  return (
    <div className="nh-app">
      <div className="mx-auto min-h-dvh max-w-md">
        {/* Foto hero, memudar ke latar halaman */}
        <div className="relative h-[46dvh] min-h-80 w-full overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={asset("/img/hero-login.jpg")} alt="" className="h-full w-full object-cover" />
          {/* Pola merek sebagai tekstur tipis di atas foto, di bawah gradasi. */}
          <div className="nh-pattern-brand pointer-events-none absolute inset-0" aria-hidden />
          <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/25 to-[#f3ece2]" />
          <div className="absolute inset-x-0 top-0 p-6 pt-[max(env(safe-area-inset-top),1.5rem)]">
            {/* Wordmark lime di atas hero gelap (PNG putih sebagai mask). */}
            <div className="nh-logo-lime h-7 w-[204px]" role="img" aria-label="NüHabit" />
          </div>
          <div className="absolute inset-x-0 bottom-14 px-6">
            <h1 className="nh-display text-4xl leading-[1.05] text-white drop-shadow-[0_2px_12px_rgb(0_0_0/0.4)]">
              {t("Train hard.")}
              <br />
              {t("Check in faster.")}
            </h1>
          </div>
        </div>

        {/* Kartu form mengambang - relative supaya tergambar di atas overlay hero */}
        <div className="relative -mt-10 px-4 pb-10">
          <div className="nh-card !p-6">
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (!canSubmit) return;
                void (otp.step === "phone" ? otp.requestOtp() : otp.verifyOtp());
              }}
            >
              <div>
                <p className="nh-display text-2xl">{t("Sign in")}</p>
                <p className="mt-0.5 text-sm text-nh-muted">
                  {otp.step === "phone"
                    ? t("Use the WhatsApp number on your membership.")
                    : t("We sent a 6-digit code to WhatsApp {phone}.", { phone: otp.phone })}
                </p>
              </div>
              {otp.step === "phone" ? (
                <div>
                  <label className="nh-label" htmlFor="phone">
                    {t("WhatsApp number")}
                  </label>
                  <input
                    id="phone"
                    className="nh-input"
                    type="tel"
                    inputMode="tel"
                    value={otp.phone}
                    onChange={(e) => otp.setPhone(e.target.value)}
                    placeholder="08xxxxxxxxxx"
                    autoComplete="tel"
                  />
                </div>
              ) : (
                <div>
                  <label className="nh-label" htmlFor="code">
                    {t("Verification code")}
                  </label>
                  <input
                    id="code"
                    className="nh-input text-center text-2xl tracking-[0.5em]"
                    value={otp.code}
                    onChange={(e) => otp.setCode(e.target.value.slice(0, 6))}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="123456"
                    autoFocus
                  />
                </div>
              )}
              <button
                type="submit"
                className="nh-btn-brand flex items-center justify-center gap-2"
                disabled={otp.busy || !canSubmit}
              >
                {otp.step === "phone" ? t("Send code") : t("Sign in")} <ArrowRight size={18} />
              </button>
              {otp.step === "code" ? (
                <button type="button" onClick={otp.backToPhone} className="text-sm font-bold text-nh-ink/60">
                  {t("Change number or resend")}
                </button>
              ) : null}
              {otp.error ? <p className="text-sm font-bold text-nh-danger">{otp.error}</p> : null}
            </form>
            {otp.step === "phone" ? (
              <div className="mt-4">
                <GoogleSignIn onSignedIn={onSignedIn} onNeedsPhone={onNeedsPhone} />
              </div>
            ) : null}
          </div>

          <Link href={m("/auth/register")} className="nh-btn-ghost mt-3 w-full">
            {t("Create your membership")}
          </Link>
        </div>
      </div>
    </div>
  );
}
