"use client";

import { useCallback, useState } from "react";

/**
 * Login OTP portal member lewat endpoint yang sudah ada: POST /otp {phone}
 * lalu POST /verify {phone, code} yang menanam cookie member_session.
 * Dipakai portal Nox dan portal mobile.
 */
export function useMemberOtp({
  onSignedIn,
  onCodeSent,
}: {
  /** `bypass` = masuk tanpa kode (dev lokal, diputuskan server). */
  onSignedIn: (bypass: boolean) => void;
  onCodeSent?: () => void;
}) {
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhoneRaw] = useState("");
  const [code, setCodeRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setPhone = (value: string) => {
    setPhoneRaw(value);
    setError(null);
  };
  const setCode = (value: string) => {
    setCodeRaw(value.replace(/\D/g, ""));
    setError(null);
  };
  const backToPhone = () => {
    setStep("phone");
    setError(null);
  };

  const requestOtp = useCallback(async () => {
    if (!phone.trim()) return;
    setBusy(true);
    setError(null);
    try {
      /* Dev lokal: coba verify tanpa kode lebih dulu. Server yang memutuskan
       * (lib/member-portal/dev-bypass) — bila bypass mati, permintaan ini
       * ditolak dan alur OTP normal di bawah tetap berjalan. Dicoba sebelum
       * /otp supaya tidak terganjal rate limit endpoint itu. */
      const bypassRes = await fetch("/api/member-portal/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      if (bypassRes.ok) {
        const bypassJson = await bypassRes.json();
        if (bypassJson.success) {
          onSignedIn(true);
          return;
        }
      }

      const res = await fetch("/api/member-portal/otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Gagal mengirim kode");
      setStep("code");
      onCodeSent?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengirim kode");
    } finally {
      setBusy(false);
    }
  }, [phone, onSignedIn, onCodeSent]);

  const verifyOtp = useCallback(async () => {
    if (!/^\d{6}$/.test(code.trim())) {
      setError("Kode harus 6 digit");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/member-portal/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, code: code.trim() }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Kode salah");
      setCodeRaw("");
      setStep("phone");
      onSignedIn(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kode salah");
    } finally {
      setBusy(false);
    }
  }, [code, phone, onSignedIn]);

  return { step, phone, setPhone, code, setCode, busy, error, requestOtp, verifyOtp, backToPhone };
}
