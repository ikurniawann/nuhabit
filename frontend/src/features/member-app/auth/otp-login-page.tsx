"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { useMemberOtp } from "../lib/use-member-otp";
import { useT } from "../lib/i18n";
import { asset, m } from "../lib/links";
import { returnPath } from "./return-path";
import "../member-app.css";

/** Secondary sign-in with a WhatsApp code; only linked when OTP is enabled. */
export function OtpLoginPage() {
  const t = useT();
  const router = useRouter();
  const qc = useQueryClient();
  const onSignedIn = useCallback(() => {
    qc.clear();
    router.replace(returnPath());
  }, [qc, router]);
  const otp = useMemberOtp({ onSignedIn });

  return (
    <div className="nh-app">
      <div className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-6 py-8">
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={asset("/brand/wordmark-black.png")} alt="NüHabit" className="mb-5 h-6 w-auto" />
          <h1 className="nh-display text-3xl font-black">
            {otp.step === "phone" ? t("Sign in with a WhatsApp code") : t("Enter the code")}
          </h1>
          <p className="mt-2 text-sm text-nh-muted">
            {otp.step === "phone"
              ? t("We will send a 6-digit code to your WhatsApp.")
              : t("We sent a code to WhatsApp {phone}.", { phone: otp.phone })}
          </p>
        </div>

        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void (otp.step === "phone" ? otp.requestOtp() : otp.verifyOtp());
          }}
        >
          {otp.step === "phone" ? (
            <div>
              <label className="nh-label" htmlFor="otp-phone">
                {t("WhatsApp number")}
              </label>
              <input
                id="otp-phone"
                className="nh-input"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={otp.phone}
                onChange={(e) => otp.setPhone(e.target.value)}
                placeholder="08xxxxxxxxxx"
              />
            </div>
          ) : (
            <div>
              <label className="nh-label" htmlFor="otp-code">
                {t("Verification code")}
              </label>
              <input
                id="otp-code"
                className="nh-input text-center text-2xl tracking-[0.5em]"
                value={otp.code}
                onChange={(e) => otp.setCode(e.target.value.slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
              />
            </div>
          )}

          {otp.error ? (
            <p className="text-sm font-bold text-nh-danger" role="alert">
              {t(otp.error)}
            </p>
          ) : null}

          <button
            type="submit"
            className="nh-btn-brand"
            disabled={otp.busy || (otp.step === "phone" ? otp.phone.trim().length < 6 : otp.code.length < 6)}
          >
            {otp.step === "phone" ? t("Send code") : t("Verify")}
          </button>

          {otp.step === "code" ? (
            <button type="button" className="nh-btn-ghost" onClick={otp.backToPhone}>
              {t("Change number")}
            </button>
          ) : null}
        </form>

        <Link href={m("/auth/login")} className="mt-auto flex items-center gap-1 text-sm font-bold text-nh-forest">
          <ArrowLeft size={16} /> {t("Sign in with your password")}
        </Link>
      </div>
    </div>
  );
}
