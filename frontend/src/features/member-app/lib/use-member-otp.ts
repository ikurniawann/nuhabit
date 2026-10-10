"use client";

import { useCallback, useState } from "react";

/**
 * WhatsApp code sign-in through the existing endpoints: POST /otp {phone},
 * then POST /verify {phone, code}, which sets the member_session cookie.
 * Messages are English keys; the screen runs them through t().
 */
export function useMemberOtp({
  onSignedIn,
  onCodeSent,
}: {
  /** `bypass` = signed in without a code (local dev, decided by the server). */
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
      // Local dev: try verify without a code first. The server decides; when the
      // bypass is off this is rejected and the normal OTP flow below runs. It goes
      // before /otp so it does not eat that endpoint's rate limit.
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
      if (!res.ok || !json.success) throw new Error(json.error || "Could not send the code.");
      setStep("code");
      onCodeSent?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the code.");
    } finally {
      setBusy(false);
    }
  }, [phone, onSignedIn, onCodeSent]);

  const verifyOtp = useCallback(async () => {
    if (!/^\d{6}$/.test(code.trim())) {
      setError("Enter the 6-digit code.");
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
      if (!res.ok || !json.success) throw new Error(json.error || "That code is not right.");
      setCodeRaw("");
      setStep("phone");
      onSignedIn(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That code is not right.");
    } finally {
      setBusy(false);
    }
  }, [code, phone, onSignedIn]);

  return { step, phone, setPhone, code, setCode, busy, error, requestOtp, verifyOtp, backToPhone };
}
