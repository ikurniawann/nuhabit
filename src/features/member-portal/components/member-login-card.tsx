"use client";

import Image from "next/image";
import { useState } from "react";
import { ArrowLeft, Loader2, MessageCircle, ShieldCheck } from "lucide-react";

/** Login OTP WhatsApp 2 langkah (nomor → kode). EPIC-011 Fase D. */
export function MemberLoginCard({ onSuccess }: { onSuccess: () => void }) {
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  async function requestOtp() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/member-portal/otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Gagal mengirim kode");
        return;
      }
      setInfo("Kode dikirim ke WhatsApp Anda — berlaku 5 menit.");
      setStep("code");
    } catch {
      setError("Jaringan bermasalah — coba lagi");
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/member-portal/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, code }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Kode salah");
        return;
      }
      onSuccess();
    } catch {
      setError("Jaringan bermasalah — coba lagi");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col justify-center gap-7 py-8">
      <div className="mp-rise flex flex-col items-center text-center">
        <Image
          src="/logos/bcd-coffee-icon.png"
          alt="BCD Coffee"
          width={112}
          height={112}
          className="size-28 object-contain"
          priority
        />
        <h1 className="mt-1 text-2xl font-bold" style={{ color: "var(--mp-ink)" }}>
          Portal Member
        </h1>
        <p className="mt-1.5 max-w-[19rem] text-sm text-[color:var(--mp-ink-soft)]">
          Cek saldo ARK Coin, XP, tier, dan tukar reward Anda.
        </p>
      </div>

      <div className="mp-rise mp-rise-1 rounded-3xl bg-white/85 p-5 shadow-lg shadow-black/5 ring-1 ring-black/5 backdrop-blur">
        <div className="flex items-center gap-2 border-b border-black/5 pb-3">
          <span className="grid size-8 place-items-center rounded-full bg-emerald-50">
            <MessageCircle className="size-4 text-emerald-600" />
          </span>
          <h2 className="text-sm font-semibold" style={{ color: "var(--mp-ink)" }}>
            {step === "phone" ? "Masuk dengan WhatsApp" : "Masukkan kode OTP"}
          </h2>
        </div>

        <div className="space-y-3 pt-4">
          {step === "phone" ? (
            <>
              <label className="block">
                <span className="mp-label text-[color:var(--mp-ink-soft)]">
                  No. WhatsApp terdaftar
                </span>
                <input
                  type="tel"
                  inputMode="tel"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="08xxxxxxxxxx"
                  onKeyDown={(event) => event.key === "Enter" && requestOtp()}
                  className="mp-figure mt-1.5 h-12 w-full rounded-xl border border-black/10 bg-white px-4 text-base outline-none transition focus:border-[color:var(--brand-primary)] focus:ring-4 focus:ring-[color:var(--mp-line)]"
                />
              </label>
              <PrimaryButton onClick={requestOtp} disabled={busy || !phone}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : "Kirim Kode OTP"}
              </PrimaryButton>
            </>
          ) : (
            <>
              {info && (
                <p className="flex items-start gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                  <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
                  {info}
                </p>
              )}
              <label className="block">
                <span className="mp-label text-[color:var(--mp-ink-soft)]">Kode 6 digit</span>
                <input
                  inputMode="numeric"
                  maxLength={6}
                  autoFocus
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
                  placeholder="••••••"
                  onKeyDown={(event) => event.key === "Enter" && verify()}
                  className="mp-figure mt-1.5 h-14 w-full rounded-xl border border-black/10 bg-white text-center text-2xl font-bold tracking-[0.45em] outline-none transition focus:border-[color:var(--brand-primary)] focus:ring-4 focus:ring-[color:var(--mp-line)]"
                />
              </label>
              <PrimaryButton onClick={verify} disabled={busy || code.length !== 6}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : "Masuk"}
              </PrimaryButton>
              <button
                type="button"
                onClick={() => {
                  setStep("phone");
                  setCode("");
                  setInfo("");
                  setError("");
                }}
                className="flex w-full items-center justify-center gap-1.5 py-1 text-xs text-[color:var(--mp-ink-soft)] transition hover:text-[color:var(--mp-ink)]"
              >
                <ArrowLeft className="size-3.5" />
                Ganti nomor / kirim ulang
              </button>
            </>
          )}

          {error && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>
          )}
        </div>
      </div>

      <p className="mp-rise mp-rise-2 text-center text-xs text-[color:var(--mp-ink-soft)]">
        Belum jadi member? Daftar gratis di kasir venue kami.
      </p>
    </div>
  );
}

function PrimaryButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold text-white shadow-lg transition active:scale-[0.99] disabled:opacity-50 disabled:shadow-none"
      style={{
        backgroundColor: "var(--brand-primary)",
        boxShadow: "0 10px 20px -10px var(--brand-primary)",
      }}
    >
      {children}
    </button>
  );
}
