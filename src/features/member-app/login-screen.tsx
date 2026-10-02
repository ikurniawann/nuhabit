"use client";

import { useState } from "react";
import Image from "next/image";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toEnglish } from "./i18n";
import { memberFetch } from "./lib";
import { Notice, PillButton } from "./ui";

/** Login Member App: nomor WhatsApp → kode OTP (API portal member EPIC-011). */
export function LoginScreen({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function verify(withCode: string) {
    await memberFetch("/api/member-portal/verify", { method: "POST", body: { phone, code: withCode } });
    onLoggedIn();
  }

  async function requestOtp() {
    setBusy(true);
    setError(null);
    try {
      const res = await memberFetch<{ message: string; dev_bypass?: boolean; dev_fixed_code?: string }>("/api/member-portal/otp", { method: "POST", body: { phone } });
      if (res.dev_bypass) {
        await verify("");
        return;
      }
      setInfo(res.dev_fixed_code ? `Development mode: WhatsApp isn't connected yet — use code ${res.dev_fixed_code}.` : toEnglish(res.message));
      setStep("code");
    } catch (e) {
      setError(e instanceof Error ? e.message : "We couldn't send the code");
    } finally {
      setBusy(false);
    }
  }

  async function submitCode() {
    setBusy(true);
    setError(null);
    try {
      await verify(code);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That code isn't right");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-nh-ink text-nh-beige">
      <Image src="/brand/wallpaper-ink.webp" alt="" fill priority className="object-cover opacity-60" />
      <div className="absolute inset-0 bg-gradient-to-b from-nh-ink/30 via-nh-ink/70 to-nh-ink" />
      <div className="relative mx-auto flex w-full max-w-lg flex-1 flex-col px-6 pb-10 pt-14">
        <Image src="/brand/logo-neon.png" alt="NUHABIT" width={1325} height={173} className="h-6 w-auto self-start" priority />
        <div className="mt-auto">
          <h1 className="font-display text-4xl font-bold uppercase leading-[1.05] tracking-tight">
            Train today,
            <br />
            <span className="text-nh-lime">build tomorrow.</span>
          </h1>
          <p className="mt-3 text-sm text-nh-beige/70">Sign in with the WhatsApp number registered at the venue.</p>

          <form
            className="mt-8 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (step === "phone") void requestOtp();
              else void submitCode();
            }}
          >
            {step === "phone" ? (
              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-nh-beige/60">WhatsApp number</span>
                <input
                  inputMode="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="0812 3456 7890"
                  className="nh-dark-input w-full rounded-2xl border border-white/15 bg-white/5 px-4 py-3.5 text-base text-nh-beige placeholder:text-nh-beige/30 focus:border-nh-lime focus:outline-none"
                />
              </label>
            ) : (
              <>
                <button type="button" onClick={() => { setStep("phone"); setCode(""); setError(null); }} className="flex items-center gap-1.5 text-sm text-nh-beige/70">
                  <ArrowLeft className="size-4" /> Change number
                </button>
                {info && <Notice tone="ok">{info}</Notice>}
                <label className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-nh-beige/60">6-digit code</span>
                  <input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                    placeholder="••••••"
                    className="nh-dark-input w-full rounded-2xl border border-white/15 bg-white/5 px-4 py-3.5 text-center font-display text-2xl tracking-[0.5em] text-nh-beige placeholder:text-nh-beige/30 focus:border-nh-lime focus:outline-none"
                  />
                </label>
              </>
            )}
            {error && <Notice tone="error">{error}</Notice>}
            <PillButton type="submit" disabled={busy || (step === "phone" ? phone.replace(/\D/g, "").length < 9 : code.length !== 6)} className="w-full">
              {busy && <Loader2 className="size-4 animate-spin" />}
              {step === "phone" ? "Send code" : "Sign in"}
            </PillButton>
          </form>
          <p className="mt-6 text-center text-xs text-nh-beige/50">Not a member yet? Sign up at the front desk — every athlete starts somewhere.</p>
        </div>
      </div>
    </div>
  );
}
