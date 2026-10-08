"use client";

import { useCallback, useState } from "react";

export function useMemberLogin({
  onSignedIn,
}: {
  onSignedIn: () => void;
}) {
  const [username, setUsernameRaw] = useState("");
  const [password, setPasswordRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setUsername = (value: string) => {
    setUsernameRaw(value);
    setError(null);
  };
  const setPassword = (value: string) => {
    setPasswordRaw(value);
    setError(null);
  };

  const login = useCallback(async () => {
    // Password wajib: server menolak login tanpa password (401/403), jadi
    // permintaan kosong tidak perlu dikirim sama sekali.
    if (!username.trim()) {
      setError("Username wajib diisi");
      return;
    }
    if (!password) {
      setError("Password wajib diisi");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/member-portal/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Gagal masuk");

      onSignedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal masuk");
    } finally {
      setBusy(false);
    }
  }, [username, password, onSignedIn]);

  return { username, setUsername, password, setPassword, busy, error, login };
}
