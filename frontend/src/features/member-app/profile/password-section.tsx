"use client";

import { useState, type FormEvent } from "react";
import { passwordError } from "../auth/password-rules";
import { ApiError, memberApi } from "../lib/api";
import { useT } from "../lib/i18n";
import { loyaltyKeys, useLoyaltyMe, useRefresh } from "../lib/queries-loyalty";

/** Set or change the sign-in password (PUT /password). Linked from the home prompt as #password. */
export function PasswordSection() {
  const t = useT();
  const { data: me } = useLoyaltyMe();
  const refresh = useRefresh();
  const hasPassword = me?.hasPassword ?? true;
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const invalid = passwordError(next);
    if (invalid) {
      setError(t(invalid));
      return;
    }
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      await memberApi("/password", {
        method: "PUT",
        json: hasPassword ? { current_password: current, new_password: next } : { new_password: next },
      });
      setCurrent("");
      setNext("");
      setSaved(true);
      await refresh(loyaltyKeys.me);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("Request failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form id="password" className="nh-card flex flex-col gap-4 text-sm" noValidate onSubmit={submit}>
      <div>
        <p className="nh-label !mb-0">{hasPassword ? t("Change password") : t("Set a password")}</p>
        <p className="mt-1 text-xs text-nh-muted">
          {hasPassword ? t("Other devices will be signed out after the change.") : t("Sign in with it instead of a WhatsApp code.")}
        </p>
      </div>
      {hasPassword ? (
        <div>
          <label className="nh-label" htmlFor="current-password">
            {t("Current password")}
          </label>
          <input
            id="current-password"
            className="nh-input"
            type="password"
            value={current}
            onChange={(e) => {
              setCurrent(e.target.value);
              setError("");
            }}
            autoComplete="current-password"
          />
        </div>
      ) : null}
      <div>
        <label className="nh-label" htmlFor="new-password">
          {t("New password")}
        </label>
        <input
          id="new-password"
          className="nh-input"
          type="password"
          value={next}
          onChange={(e) => {
            setNext(e.target.value);
            setError("");
            setSaved(false);
          }}
          autoComplete="new-password"
        />
        <p className="mt-1 text-xs text-nh-muted">{t("8 to 72 characters with at least one letter and one digit.")}</p>
      </div>
      {error ? (
        <p className="text-xs font-semibold text-nh-danger" role="alert">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p className="text-xs font-semibold text-nh-ok" role="status">
          {t("Password saved.")}
        </p>
      ) : null}
      <button type="submit" className="nh-btn-brand !py-2" disabled={busy || !next || (hasPassword && !current)}>
        {t("Save password")}
      </button>
    </form>
  );
}
