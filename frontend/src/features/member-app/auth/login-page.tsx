"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { OTP_ENABLED } from "@/lib/otp-availability";
import { useMemberLogin } from "../lib/use-member-login";
import { useT } from "../lib/i18n";
import { asset, m } from "../lib/links";
import { GoogleSignIn, type GoogleNeedsPhone } from "./google-sign-in";
import { returnPath } from "./return-path";
import "../member-app.css";

export function LoginPage() {
  const t = useT();
  const router = useRouter();
  const qc = useQueryClient();
  const onSignedIn = useCallback(() => {
    // Drop the cached 401 from the old session so the app guard reloads.
    qc.clear();
    router.replace(returnPath());
  }, [qc, router]);

  const auth = useMemberLogin({ onSignedIn });

  // A Google account without a member finishes sign-up with a WhatsApp number.
  const onNeedsPhone = useCallback(
    (identity: GoogleNeedsPhone) => {
      router.push(`${m("/auth/register")}?${new URLSearchParams({ ...identity })}`);
    },
    [router]
  );

  return (
    <div className="nh-app">
      <div className="mx-auto min-h-dvh max-w-md">
        <div className="relative h-[46dvh] min-h-80 w-full overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={asset("/img/hero-login.jpg")} alt="" className="h-full w-full object-cover" />
          <div className="nh-pattern-brand pointer-events-none absolute inset-0" aria-hidden />
          <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/25 to-white" />
          <div className="absolute inset-x-0 top-0 p-6 pt-[max(env(safe-area-inset-top),1.5rem)]">
            <div className="nh-logo-lime h-7 w-[204px]" role="img" aria-label="NüHabit" />
          </div>
          <div className="absolute inset-x-0 bottom-14 px-6">
            <h1 className="nh-display text-4xl leading-[1.05] text-white drop-shadow-[0_2px_12px_rgb(0_0_0/0.4)]">
              {t("Train hard.")}
              <br />
              {t("Check in faster.")}
            </h1>
          </div>
        </div>

        <div className="relative -mt-10 px-4 pb-10">
          <div className="nh-card !p-6">
            <form
              className="flex flex-col gap-4"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                void auth.login();
              }}
            >
              <div>
                <p className="nh-display text-2xl">{t("Sign in")}</p>
                <p className="mt-0.5 text-sm text-nh-muted">{t("Use your WhatsApp number or email and your password.")}</p>
              </div>

              <div>
                <label className="nh-label" htmlFor="username">
                  {t("WhatsApp number or email")}
                </label>
                <input
                  id="username"
                  className="nh-input"
                  type="text"
                  value={auth.username}
                  onChange={(e) => auth.setUsername(e.target.value)}
                  placeholder="08xxxxxxxxxx"
                  autoComplete="username"
                  autoCapitalize="none"
                  aria-invalid={Boolean(auth.fieldErrors.username)}
                />
                {auth.fieldErrors.username ? (
                  <p className="mt-1 text-xs font-bold text-nh-danger">{t(auth.fieldErrors.username)}</p>
                ) : null}
              </div>

              <div>
                <div className="flex items-baseline justify-between">
                  <label className="nh-label" htmlFor="password">
                    {t("Password")}
                  </label>
                  <Link href={m("/auth/forgot")} className="text-xs font-bold text-nh-forest">
                    {t("Forgot password?")}
                  </Link>
                </div>
                <input
                  id="password"
                  className="nh-input"
                  type="password"
                  value={auth.password}
                  onChange={(e) => auth.setPassword(e.target.value)}
                  placeholder="********"
                  autoComplete="current-password"
                  aria-invalid={Boolean(auth.fieldErrors.password)}
                />
                {auth.fieldErrors.password ? (
                  <p className="mt-1 text-xs font-bold text-nh-danger">{t(auth.fieldErrors.password)}</p>
                ) : null}
              </div>

              <button type="submit" className="nh-btn-brand flex items-center justify-center gap-2" disabled={auth.busy}>
                {t("Sign in")} <ArrowRight size={18} />
              </button>

              {auth.error ? (
                <p className="text-sm font-bold text-nh-danger" role="alert">
                  {t(auth.error)}
                  {auth.noPassword ? (
                    <>
                      {" "}
                      <Link href={m("/auth/forgot")} className="underline">
                        {t("Forgot password")}
                      </Link>
                    </>
                  ) : null}
                </p>
              ) : null}
            </form>

            <div className="mt-4">
              <GoogleSignIn onSignedIn={onSignedIn} onNeedsPhone={onNeedsPhone} />
            </div>

            {OTP_ENABLED ? (
              <Link href={m("/auth/otp")} className="mt-4 block text-center text-sm font-bold text-nh-forest">
                {t("Sign in with a WhatsApp code")}
              </Link>
            ) : null}
          </div>

          {OTP_ENABLED ? (
            <Link href={m("/auth/register")} className="nh-btn-ghost mt-3 w-full">
              {t("Create your membership")}
            </Link>
          ) : (
            <p className="mt-4 text-center text-sm text-nh-muted">{t("New here? The front desk creates your membership.")}</p>
          )}
        </div>
      </div>
    </div>
  );
}
