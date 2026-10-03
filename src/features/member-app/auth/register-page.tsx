"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { WAIVER_VERSION } from "@/lib/member-app/home";
import { memberApi } from "../lib/api";
import { useT } from "../lib/i18n";
import { asset, m } from "../lib/links";
import "../member-app.css";

const STEPS = ["Contact", "Verify", "Personal", "Emergency", "Waiver"] as const;

type Gender = "MALE" | "FEMALE" | "OTHER";

type PostResult<T> = Partial<T> & { success: boolean; error?: string; field?: string };

/** POST JSON ke API portal member; endpoint daftar menjawab tanpa `data`, jadi JSON utuh dikembalikan. */
async function post<T = object>(path: string, body: unknown): Promise<PostResult<T>> {
  try {
    const res = await fetch(`/api/member-portal${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await res.json()) as PostResult<T>;
  } catch {
    return { success: false } as PostResult<T>;
  }
}

export function RegisterPage() {
  const t = useT();
  const router = useRouter();
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [devBypass, setDevBypass] = useState(false);
  const [code, setCode] = useState("");
  const [fullName, setFullName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [gender, setGender] = useState<Gender | "">("");
  const [ecName, setEcName] = useState("");
  const [ecPhone, setEcPhone] = useState("");
  const [ecRelation, setEcRelation] = useState("");
  const [waiverAccepted, setWaiverAccepted] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);

  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));

  const requestOtp = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await post<{ dev_bypass?: boolean }>("/register/otp", { phone });
      if (!res.success) {
        setError(res.error ?? t("Something went wrong."));
        return;
      }
      setDevBypass(Boolean(res.dev_bypass));
      next();
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await post("/register", {
        phone,
        code,
        name: fullName,
        email,
        birth_date: dateOfBirth,
        wa_consent: false,
      });
      if (!res.success) {
        setError(res.error ?? t("Something went wrong."));
        if (res.field === "code") setStep(1);
        return;
      }
      // Akun sudah dibuat dan sesi aktif; kontak darurat, waiver, dan gender menyusul.
      await Promise.allSettled([
        memberApi("/app/home/me", {
          method: "PATCH",
          json: {
            emergencyContact:
              ecName && ecPhone ? { name: ecName, phone: ecPhone, relation: ecRelation || "Contact" } : null,
            acceptWaiver: true,
          },
        }),
        gender === "MALE" || gender === "FEMALE"
          ? memberApi("/profile", { method: "PUT", json: { gender: gender.toLowerCase() } })
          : Promise.resolve(),
      ]);
      qc.clear();
      router.replace(m("/"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="nh-app">
      <div className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-6 py-8">
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={asset("/brand/wordmark-black.png")} alt="NüHabit" className="mb-5 h-6 w-auto" />
          <h1 className="nh-display text-3xl font-black">{t("Join the studio")}</h1>
          <div className="mt-4 flex gap-1.5">
            {STEPS.map((s, i) => (
              <div key={s} className={`h-1.5 flex-1 rounded-full ${i <= step ? "bg-nh-forest" : "bg-nh-line"}`} />
            ))}
          </div>
          <p className="mt-2 text-xs font-bold tracking-wider text-nh-muted uppercase">
            {t("Step {n} of {total} - {step}", { n: step + 1, total: STEPS.length, step: t(STEPS[step]) })}
          </p>
        </div>

        {step === 0 ? (
          <div className="flex flex-col gap-4">
            <div>
              <label className="nh-label">{t("Email")}</label>
              <input
                className="nh-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label className="nh-label">{t("WhatsApp number")}</label>
              <input
                className="nh-input"
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="08xxxxxxxxxx"
              />
            </div>
            <button
              className="nh-btn-brand"
              disabled={busy || !email.includes("@") || phone.length < 6}
              onClick={() => void requestOtp()}
            >
              {t("Send verification code")}
            </button>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="flex flex-col gap-4">
            <div>
              <label className="nh-label">{t("Verification code")}</label>
              <input
                className="nh-input text-center text-2xl tracking-[0.5em]"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
              />
              <p className="mt-2 text-xs text-nh-muted">
                {devBypass
                  ? t("Local dev: no code needed, continue.")
                  : t("We sent a code to WhatsApp {phone}.", { phone })}
              </p>
            </div>
            <button className="nh-btn-brand" disabled={!devBypass && code.length < 6} onClick={next}>
              {t("Verify")}
            </button>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="flex flex-col gap-4">
            <div>
              <label className="nh-label">{t("Full name")}</label>
              <input className="nh-input" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
            <div>
              <label className="nh-label">{t("Date of birth")}</label>
              <input
                type="date"
                className="nh-input"
                value={dateOfBirth}
                onChange={(e) => setDateOfBirth(e.target.value)}
              />
            </div>
            <div>
              <label className="nh-label">{t("Gender")}</label>
              <div className="flex gap-2">
                {(["MALE", "FEMALE", "OTHER"] as const).map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setGender(g)}
                    className={`flex-1 rounded-xl border px-3 py-2.5 text-sm font-bold ${
                      gender === g
                        ? "border-nh-forest bg-nh-forest/10 text-nh-forest"
                        : "border-nh-line bg-nh-cream text-nh-muted"
                    }`}
                  >
                    {t(g[0] + g.slice(1).toLowerCase())}
                  </button>
                ))}
              </div>
            </div>
            <button className="nh-btn-brand" disabled={fullName.trim().length < 2} onClick={next}>
              {t("Continue")}
            </button>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="flex flex-col gap-4">
            <div>
              <label className="nh-label">{t("Contact name")}</label>
              <input className="nh-input" value={ecName} onChange={(e) => setEcName(e.target.value)} />
            </div>
            <div>
              <label className="nh-label">{t("Contact phone")}</label>
              <input className="nh-input" value={ecPhone} onChange={(e) => setEcPhone(e.target.value)} />
            </div>
            <div>
              <label className="nh-label">{t("Relationship")}</label>
              <input
                className="nh-input"
                value={ecRelation}
                onChange={(e) => setEcRelation(e.target.value)}
                placeholder={t("Spouse, parent…")}
              />
            </div>
            <button className="nh-btn-brand" onClick={next}>
              {t("Continue")}
            </button>
          </div>
        ) : null}

        {step === 4 ? (
          <div className="flex flex-col gap-4">
            <div className="nh-card max-h-48 overflow-y-auto text-sm leading-relaxed text-nh-muted">
              <p className="mb-2 font-black text-nh-ink uppercase">
                {t("Digital waiver (v{v})", { v: WAIVER_VERSION })}
              </p>
              <p>
                {t(
                  "I acknowledge that HYROX-style functional training involves inherent physical risks. I confirm I am medically fit to participate, and I release NüHabit, its staff and coaches from liability for injuries sustained during training, except in cases of gross negligence. I consent to the studio storing my membership and attendance data for operating the facility."
                )}
              </p>
            </div>
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                checked={waiverAccepted}
                onChange={(e) => setWaiverAccepted(e.target.checked)}
                className="mt-0.5 h-5 w-5 accent-[var(--color-nh-forest)]"
              />
              {t("I have read and accept the digital waiver.")}
            </label>
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                checked={termsAccepted}
                onChange={(e) => setTermsAccepted(e.target.checked)}
                className="mt-0.5 h-5 w-5 accent-[var(--color-nh-forest)]"
              />
              {t("I agree to the membership terms & conditions.")}
            </label>
            <button
              className="nh-btn-brand"
              disabled={busy || !waiverAccepted || !termsAccepted}
              onClick={() => void submit()}
            >
              {t("Create my membership")}
            </button>
          </div>
        ) : null}

        {error ? <p className="text-sm font-bold text-nh-danger">{error}</p> : null}

        <div className="mt-auto flex items-center justify-between text-sm text-nh-muted">
          {step > 0 && step !== 1 ? (
            <button onClick={back} className="font-bold">
              {t("← Back")}
            </button>
          ) : (
            <span />
          )}
          <Link href={m("/auth/login")} className="font-bold text-nh-forest">
            {t("I already have an account")}
          </Link>
        </div>
      </div>
    </div>
  );
}
