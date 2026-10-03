"use client";

import { useState } from "react";
import Image from "next/image";
import { useMemberOtp } from "../use-member-otp";
import { setLang, useLang, useT } from "./mobile-i18n";
import { MobileRegister } from "./mobile-register";

/** Masuk dengan nomor WhatsApp + kode OTP 6 digit, atau daftar sebagai member baru. */
export function MobileLogin({ onSignedIn }: { onSignedIn: () => void }) {
  const t = useT();
  const lang = useLang();
  const [mode, setMode] = useState<"login" | "register">("login");
  const otp = useMemberOtp({ onSignedIn });
  const notRegistered = otp.error?.includes("belum terdaftar") ?? false;

  return (
    <div className="flex min-h-dvh flex-col px-6 pt-[max(env(safe-area-inset-top),2.5rem)] pb-10">
      <div className="flex items-center justify-between">
        <Image
          src="/member-assets/brand/wordmark-black.png"
          alt="NüHabit"
          width={1200}
          height={165}
          unoptimized
          className="h-6 w-auto"
        />
        <button
          type="button"
          onClick={() => setLang(lang === "id" ? "en" : "id")}
          className="nh-chip bg-nh-raised text-nh-ink"
          aria-label={t("Ganti bahasa")}
        >
          {lang === "id" ? "EN" : "ID"}
        </button>
      </div>

      <div className="nh-surface-ink relative mt-8 overflow-hidden rounded-3xl p-6 text-white">
        <div className="pointer-events-none absolute -top-24 -right-16 size-56 rounded-full bg-nh-lime/20 blur-3xl" />
        <p className="relative text-[10px] font-bold tracking-[0.22em] text-white/50 uppercase">{t("Portal member")}</p>
        <p className="nh-display relative mt-2 text-3xl leading-tight">
          {t("ARK Coin, XP, dan riwayat Anda di satu tempat.")}
        </p>
      </div>

      {mode === "register" ? (
        <MobileRegister onSignedIn={onSignedIn} onLogin={() => setMode("login")} />
      ) : (
        <>
          <h1 className="nh-display mt-10 text-3xl">{t("Masuk")}</h1>
          <p className="mt-1 text-sm text-nh-muted">
            {otp.step === "phone"
              ? t("Masukkan nomor WhatsApp member Anda. Kode OTP dikirim ke sana.")
              : t("Kode 6 digit sudah dikirim ke WhatsApp {phone}.", { phone: otp.phone })}
          </p>

          <form
            className="mt-6 flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void (otp.step === "phone" ? otp.requestOtp() : otp.verifyOtp());
            }}
          >
            {otp.step === "phone" ? (
              <label>
                <span className="nh-label">{t("Nomor WhatsApp")}</span>
                <input
                  className="nh-input"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="08xxxxxxxxxx"
                  value={otp.phone}
                  onChange={(e) => otp.setPhone(e.target.value)}
                />
              </label>
            ) : (
              <label>
                <span className="nh-label">{t("Kode OTP")}</span>
                <input
                  className="nh-input text-center font-mono text-2xl tracking-[0.5em]"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="······"
                  value={otp.code}
                  onChange={(e) => otp.setCode(e.target.value)}
                  autoFocus
                />
              </label>
            )}

            {otp.error && (
              <p role="alert" className="rounded-2xl bg-nh-danger/10 px-4 py-3 text-sm text-nh-danger">
                {otp.error}
              </p>
            )}

            <button
              type="submit"
              className="nh-btn-brand w-full"
              disabled={otp.busy || (otp.step === "phone" ? !otp.phone.trim() : otp.code.trim().length !== 6)}
            >
              {otp.step === "phone"
                ? otp.busy
                  ? t("Mengirim…")
                  : t("Kirim kode OTP")
                : otp.busy
                  ? t("Memeriksa…")
                  : t("Verifikasi")}
            </button>
            {otp.step === "code" && (
              <button type="button" onClick={otp.backToPhone} className="text-sm font-bold text-nh-ink/60">
                {t("Ganti nomor atau kirim ulang")}
              </button>
            )}
          </form>

          <div className={`mt-8 rounded-3xl p-5 ${notRegistered ? "nh-surface-brand" : "bg-nh-raised"}`}>
            <p className="text-sm font-extrabold">{t("Belum jadi member?")}</p>
            <p className="mt-1 text-sm text-nh-ink/70">
              {t("Daftar gratis dengan nomor WhatsApp, langsung dapat kartu member digital.")}
            </p>
            <button type="button" onClick={() => setMode("register")} className="nh-btn-ghost mt-3 w-full bg-white">
              {t("Daftar")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
