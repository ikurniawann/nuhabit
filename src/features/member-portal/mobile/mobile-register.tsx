"use client";

import { useState } from "react";
import { validateRegistration, type RegistrationField } from "@/lib/member-portal/register";
import { useT } from "./mobile-i18n";
import { ErrorNote } from "./mobile-ui";

type Step = "phone" | "code" | "details";

const STEPS: Step[] = ["phone", "code", "details"];

/**
 * Daftar mandiri: nomor WhatsApp → kode OTP → data diri. Kode diperiksa
 * server saat akun dibuat; bila salah, member dikembalikan ke langkah kode
 * tanpa kehilangan isian data diri.
 */
export function MobileRegister({ onSignedIn, onLogin }: { onSignedIn: () => void; onLogin: () => void }) {
  const t = useT();
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [devBypass, setDevBypass] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [waConsent, setWaConsent] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; alreadyMember?: boolean } | null>(null);

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch {
      setError({ text: t("Periksa koneksi Anda, lalu coba lagi.") });
    } finally {
      setBusy(false);
    }
  };

  const post = async (url: string, body: unknown) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok && json.success === true, json };
  };

  const requestCode = () =>
    run(async () => {
      const { ok, json } = await post("/api/member-portal/register/otp", { phone });
      if (!ok) {
        setError({ text: json.error || t("Gagal mengirim kode"), alreadyMember: json.code === "already_registered" });
        return;
      }
      setDevBypass(json.dev_bypass === true);
      setStep(json.dev_bypass ? "details" : "code");
    });

  const submit = () =>
    run(async () => {
      const local = validateRegistration({ phone, name, email, birth_date: birthDate, wa_consent: waConsent });
      if (!local.ok) {
        setError({ text: t(local.error) });
        if (local.field === "phone") setStep("phone");
        return;
      }
      const { ok, json } = await post("/api/member-portal/register", {
        phone,
        code: devBypass ? "" : code,
        name,
        email,
        birth_date: birthDate,
        wa_consent: waConsent,
      });
      if (ok) {
        onSignedIn();
        return;
      }
      setError({ text: json.error || t("Pendaftaran gagal. Coba lagi.") });
      // Kode salah/kedaluwarsa: kembali ke langkah kode, data diri tetap tersimpan.
      if (json.field === "code") setStep("code");
      if (json.field === "phone") setStep("phone");
    });

  const stepIndex = STEPS.indexOf(step);
  const fieldError = (field: RegistrationField) => {
    const result = validateRegistration({ phone, name, email, birth_date: birthDate });
    return !result.ok && result.field === field;
  };

  return (
    <>
      <h1 className="nh-display mt-10 text-3xl">{t("Daftar member")}</h1>
      <div className="mt-4 flex gap-1.5" aria-hidden>
        {STEPS.map((s, i) => (
          <span key={s} className={`h-1.5 flex-1 rounded-full ${i <= stepIndex ? "bg-nh-forest" : "bg-nh-line"}`} />
        ))}
      </div>
      <p className="mt-2 text-sm text-nh-muted">
        {step === "phone" && t("Masukkan nomor WhatsApp Anda. Kode verifikasi dikirim ke sana.")}
        {step === "code" && t("Kode 6 digit sudah dikirim ke WhatsApp {phone}.", { phone })}
        {step === "details" && t("Lengkapi data diri. Email dan tanggal lahir boleh dikosongkan.")}
      </p>

      <form
        className="mt-6 flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (step === "phone") void requestCode();
          else if (step === "code") setStep("details");
          else void submit();
        }}
      >
        {step === "phone" && (
          <label>
            <span className="nh-label">{t("Nomor WhatsApp")}</span>
            <input
              className="nh-input"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="08xxxxxxxxxx"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </label>
        )}

        {step === "code" && (
          <label>
            <span className="nh-label">{t("Kode OTP")}</span>
            <input
              className="nh-input text-center font-mono text-2xl tracking-[0.5em]"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="······"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              autoFocus
            />
          </label>
        )}

        {step === "details" && (
          <>
            <label>
              <span className="nh-label">{t("Nama lengkap")}</span>
              <input
                className="nh-input"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-invalid={name.length > 0 && fieldError("name")}
                autoFocus
              />
            </label>
            <label>
              <span className="nh-label">{t("Email (opsional)")}</span>
              <input
                className="nh-input"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={email.length > 0 && fieldError("email")}
              />
            </label>
            <label>
              <span className="nh-label">{t("Tanggal lahir (opsional)")}</span>
              <input
                className="nh-input"
                type="date"
                autoComplete="bday"
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value)}
              />
            </label>
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                checked={waConsent}
                onChange={(e) => setWaConsent(e.target.checked)}
                className="mt-0.5 size-5 accent-[var(--color-nh-forest)]"
              />
              <span>{t("Kirimi saya promo dan kabar terbaru lewat WhatsApp. Bisa dimatikan kapan saja di profil.")}</span>
            </label>
          </>
        )}

        {error && (
          <div role="alert" className="flex flex-col gap-2">
            <ErrorNote>{error.text}</ErrorNote>
            {error.alreadyMember && (
              <button type="button" onClick={onLogin} className="text-sm font-bold text-nh-forest">
                {t("Masuk dengan nomor ini")}
              </button>
            )}
          </div>
        )}

        <button
          type="submit"
          className="nh-btn-brand w-full"
          disabled={
            busy ||
            (step === "phone" && !phone.trim()) ||
            (step === "code" && code.length !== 6) ||
            (step === "details" && name.trim().length < 2)
          }
        >
          {step === "phone" && (busy ? t("Mengirim…") : t("Kirim kode OTP"))}
          {step === "code" && t("Lanjut")}
          {step === "details" && (busy ? t("Mendaftarkan…") : t("Buat akun member"))}
        </button>

        {step !== "phone" && (
          <button
            type="button"
            onClick={() => setStep(step === "details" && !devBypass ? "code" : "phone")}
            className="text-sm font-bold text-nh-ink/60"
          >
            {t("Kembali")}
          </button>
        )}
      </form>

      <p className="mt-8 text-center text-sm text-nh-muted">
        {t("Sudah member?")}{" "}
        <button type="button" onClick={onLogin} className="font-bold text-nh-forest">
          {t("Masuk")}
        </button>
      </p>
    </>
  );
}
