"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useReducer, useState, type FormEvent } from "react";
import { OTP_ENABLED } from "@/lib/otp-availability";
import { ApiError, memberApi } from "../lib/api";
import { useT } from "../lib/i18n";
import { asset, m } from "../lib/links";
import { forgotTransition, initialForgotPhase } from "./forgot-steps";
import { passwordError } from "./password-rules";
import "../member-app.css";

type ForgotStarted = { status: "otp_sent"; phone_masked: string } | { status: "front_desk" };

export function ForgotPasswordPage() {
  const t = useT();
  const [phase, dispatch] = useReducer(forgotTransition, OTP_ENABLED, initialForgotPhase);
  const [username, setUsername] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("Could not reach NüHabit. Check your connection and try again."));
    } finally {
      setBusy(false);
    }
  };

  const requestCode = (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim()) {
      setError(t("Enter your WhatsApp number or email."));
      return;
    }
    void run(async () => {
      const started = await memberApi<ForgotStarted>("/password/forgot", { method: "POST", json: { username: username.trim() } });
      if (started.status === "otp_sent") {
        dispatch({ type: "otp_sent", username: username.trim(), phoneMasked: started.phone_masked });
      } else {
        dispatch({ type: "front_desk" });
      }
    });
  };

  const reset = (e: FormEvent) => {
    e.preventDefault();
    if (phase.kind !== "code") return;
    const invalid = passwordError(password);
    if (invalid) {
      setError(t(invalid));
      return;
    }
    void run(async () => {
      await memberApi("/password/reset", {
        method: "POST",
        json: { username: phase.username, code, new_password: password },
      });
      setPassword("");
      dispatch({ type: "reset" });
    });
  };

  return (
    <div className="nh-app">
      <div className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-6 py-8">
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={asset("/brand/wordmark-black.png")} alt="NüHabit" className="mb-5 h-6 w-auto" />
          <h1 className="nh-display text-3xl font-black">
            {phase.kind === "front_desk" ? t("Ask the front desk") : t("Reset your password")}
          </h1>
        </div>

        {phase.kind === "username" ? (
          <form className="flex flex-col gap-4" noValidate onSubmit={requestCode}>
            <p className="text-sm text-nh-muted">
              {t("Enter the WhatsApp number or email on your account and we will send a code to your WhatsApp.")}
            </p>
            <div>
              <label className="nh-label" htmlFor="forgot-username">
                {t("WhatsApp number or email")}
              </label>
              <input
                id="forgot-username"
                className="nh-input"
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  setError("");
                }}
                autoComplete="username"
                autoCapitalize="none"
                placeholder="08xxxxxxxxxx"
              />
            </div>
            {error ? <p className="text-sm font-bold text-nh-danger" role="alert">{error}</p> : null}
            <button type="submit" className="nh-btn-brand" disabled={busy}>
              {t("Send reset code")}
            </button>
          </form>
        ) : null}

        {phase.kind === "code" ? (
          <form className="flex flex-col gap-4" noValidate onSubmit={reset}>
            <p className="text-sm text-nh-muted">
              {t("If that account exists, a code is on its way to WhatsApp {phone}.", { phone: phase.phoneMasked })}
            </p>
            <div>
              <label className="nh-label" htmlFor="forgot-code">
                {t("Verification code")}
              </label>
              <input
                id="forgot-code"
                className="nh-input text-center text-2xl tracking-[0.5em]"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
              />
            </div>
            <div>
              <label className="nh-label" htmlFor="forgot-password">
                {t("New password")}
              </label>
              <input
                id="forgot-password"
                className="nh-input"
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError("");
                }}
                autoComplete="new-password"
              />
              <p className="mt-1 text-xs text-nh-muted">{t("8 to 72 characters with at least one letter and one digit.")}</p>
            </div>
            {error ? <p className="text-sm font-bold text-nh-danger" role="alert">{error}</p> : null}
            <button type="submit" className="nh-btn-brand" disabled={busy || code.length < 6 || !password}>
              {t("Reset password")}
            </button>
            <button type="button" className="nh-btn-ghost" onClick={() => dispatch({ type: "back" })}>
              {t("Change number")}
            </button>
          </form>
        ) : null}

        {phase.kind === "front_desk" ? (
          <div className="nh-card text-sm text-nh-muted">
            {t(
              "Password resets are handled at the front desk right now. Visit any NüHabit studio and the team will set a new password for you."
            )}
          </div>
        ) : null}

        {phase.kind === "done" ? (
          <div className="nh-card text-sm font-bold text-nh-ok" role="status">
            {t("Password updated. Sign in with your new password.")}
          </div>
        ) : null}

        <Link href={m("/auth/login")} className="mt-auto flex items-center gap-1 text-sm font-bold text-nh-forest">
          <ArrowLeft size={16} /> {t("Back to sign in")}
        </Link>
      </div>
    </div>
  );
}
