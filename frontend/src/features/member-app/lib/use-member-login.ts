"use client";

import { useCallback, useState } from "react";

export type LoginField = "username" | "password";
export type LoginFieldErrors = Partial<Record<LoginField, string>>;

interface LoginResponse {
  success: boolean;
  error?: string;
  field?: LoginField;
}

/** Status the API uses for an account that has no password yet. */
const NO_PASSWORD_STATUS = 403;

/**
 * Username and password sign-in against POST /api/member-portal/login.
 * Messages are English keys; the screen runs them through t().
 */
export function useMemberLogin({ onSignedIn }: { onSignedIn: () => void }) {
  const [username, setUsernameRaw] = useState("");
  const [password, setPasswordRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<LoginFieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [noPassword, setNoPassword] = useState(false);

  const reset = () => {
    setFieldErrors({});
    setError(null);
    setNoPassword(false);
  };
  const setUsername = (value: string) => {
    setUsernameRaw(value);
    reset();
  };
  const setPassword = (value: string) => {
    setPasswordRaw(value);
    reset();
  };

  const login = useCallback(async () => {
    const missing: LoginFieldErrors = {};
    if (!username.trim()) missing.username = "Enter your WhatsApp number or email.";
    if (!password) missing.password = "Enter your password.";
    if (missing.username || missing.password) {
      setFieldErrors(missing);
      return;
    }
    setBusy(true);
    reset();
    try {
      const res = await fetch("/api/member-portal/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const json = (await res.json().catch(() => null)) as LoginResponse | null;
      if (res.ok && json?.success) {
        onSignedIn();
        return;
      }
      const message = json?.error || "Could not sign in. Try again.";
      if (res.status === 400 && json?.field) {
        setFieldErrors({ [json.field]: message });
        return;
      }
      setError(message);
      setNoPassword(res.status === NO_PASSWORD_STATUS);
    } catch {
      setError("Could not reach NüHabit. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }, [username, password, onSignedIn]);

  return { username, setUsername, password, setPassword, busy, error, fieldErrors, noPassword, login };
}
