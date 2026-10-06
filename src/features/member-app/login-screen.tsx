"use client";

import { useState } from "react";
import Image from "next/image";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toEnglish } from "./i18n";
import { memberFetch } from "./lib";
import { MarqueeWordmark, Notice, PillButton } from "./ui";

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
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-black text-nh-beige">
      <Image src="/brand/wallpaper-ink.webp" alt="" fill priority className="object-cover opacity-40 grayscale" />
      <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/80 to-black" />
      <div className="relative mx-auto flex w-full max-w-lg flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <Image src="/brand/logo-white.png" alt="NUHABIT" width={1325} height={173} className="h-5 w-auto" priority />
          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-nh-beige/60">Member App</span>
        </div>
        <div className="mt-auto px-5 pb-8">
          <h1 className="font-display text-[3.6rem] font-bold uppercase leading-[0.86] tracking-[-0.03em] text-white">
            Train
            <br />
            today.
            <br />
            <span className="text-nh-lime">Build tomorrow.</span>
          </h1>
          <p className="mt-4 text-xs font-semibold uppercase leading-relaxed tracking-[0.08em] text-nh-beige/70">Sign in with the WhatsApp number registered at the venue.</p>

          <form
            className="mt-8 space-y-6"
            onSubmit={(e) => {
              e.preventDefault();
              if (step === "phone") void requestOtp();
              else void submitCode();
            }}
          >
            {step === "phone" ? (
              <label className="block">
                <span className="block text-sm font-medium text-white">WhatsApp number</span>
                <input
                  inputMode="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="0812 3456 7890"
                  className="nh-line-input w-full py-3 text-lg placeholder:text-nh-beige/25"
                />
              </label>
            ) : (
              <>
                <button type="button" onClick={() => { setStep("phone"); setCode(""); setError(null); }} className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-nh-beige/70 hover:text-white">
                  <ArrowLeft className="size-3.5" /> Change number
                </button>
                {info && <Notice tone="ok">{info}</Notice>}
                <label className="block">
                  <span className="block text-sm font-medium text-white">6-digit code</span>
                  <input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                    placeholder="••••••"
                    className="nh-line-input w-full py-3 font-display text-3xl tracking-[0.5em] placeholder:text-nh-beige/25"
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
          <p className="mt-6 text-[11px] uppercase leading-relaxed tracking-[0.06em] text-nh-beige/50">Not a member yet? Sign up at the front desk — every athlete starts somewhere.</p>
        </div>
        <MarqueeWordmark />
      </div>
    </div>
  );
}
