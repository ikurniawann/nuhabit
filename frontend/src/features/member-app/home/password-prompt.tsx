"use client";

import { KeyRound } from "lucide-react";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { useT } from "../lib/i18n";
import { m } from "../lib/links";
import { useLoyaltyMe } from "../lib/queries-loyalty";

const DISMISSED_KEY = "nuhabit.member.password-prompt-dismissed";
const listeners = new Set<() => void>();

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

function dismiss() {
  try {
    window.localStorage.setItem(DISMISSED_KEY, "1");
  } catch {
    // Private mode: the card comes back on the next visit.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** One-time nudge after an OTP sign-in or registration: the account has no password yet. */
export function PasswordPrompt() {
  const t = useT();
  const { data: me } = useLoyaltyMe();
  const dismissed = useSyncExternalStore(subscribe, readDismissed, () => true);

  if (dismissed || !me || me.hasPassword) return null;

  return (
    <div className="nh-card flex gap-3 !p-4">
      <span className="nh-surface-brand flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-nh-ink">
        <KeyRound size={19} strokeWidth={2.2} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-extrabold">{t("Secure your account")}</p>
        <p className="mt-0.5 text-xs text-nh-muted">{t("Set a password so you can sign in without waiting for a WhatsApp code.")}</p>
        <div className="mt-3 flex items-center gap-4 text-xs font-bold">
          <Link href={m("/profile/settings#password")} className="nh-chip bg-nh-lime text-nh-ink">
            {t("Set a password")}
          </Link>
          <button type="button" className="text-nh-muted" onClick={dismiss}>
            {t("Not now")}
          </button>
        </div>
      </div>
    </div>
  );
}
