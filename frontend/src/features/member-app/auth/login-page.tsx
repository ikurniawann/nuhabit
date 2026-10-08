"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { useMemberLogin } from "../lib/use-member-login";
import { useT } from "../lib/i18n";
import { asset, m } from "../lib/links";
import { GoogleSignIn, type GoogleNeedsPhone } from "./google-sign-in";
import "../member-app.css";

/** Tujuan setelah masuk: `?from=` dari guard aplikasi, hanya path aplikasi member. */
function returnPath(): string {
  const from = new URLSearchParams(window.location.search).get("from");
  return from && from.startsWith("/member") && !from.startsWith("//") ? from : m("/");
}

export function LoginPage() {
  const t = useT();
  const router = useRouter();
  const qc = useQueryClient();
  const [googleNotice, setGoogleNotice] = useState("");
  const onSignedIn = useCallback(() => {
    // Cache 401 dari sesi lama dibuang supaya guard aplikasi memuat ulang.
    qc.clear();
    router.replace(returnPath());
  }, [qc, router]);
  
  const auth = useMemberLogin({ onSignedIn });
  
  // Akun Google tanpa member: lengkapi nomor WhatsApp di pendaftaran.
  const onNeedsPhone = useCallback(
    (identity: GoogleNeedsPhone) => {
      router.push(`${m("/auth/register")}?${new URLSearchParams({ ...identity })}`);
    },
    [router]
  );

  // Password ikut jadi syarat: server tidak lagi menerima login tanpa password.
  const canSubmit = auth.username.trim().length >= 3 && auth.password.length > 0;

  return (
    <div className="nh-app">
      <div className="mx-auto min-h-dvh max-w-md">
        {/* Foto hero, memudar ke latar halaman */}
        <div className="relative h-[46dvh] min-h-80 w-full overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={asset("/img/hero-login.jpg")} alt="" className="h-full w-full object-cover" />
          {/* Pola merek sebagai tekstur tipis di atas foto, di bawah gradasi. */}
          <div className="nh-pattern-brand pointer-events-none absolute inset-0" aria-hidden />
          <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/25 to-white" />
          <div className="absolute inset-x-0 top-0 p-6 pt-[max(env(safe-area-inset-top),1.5rem)]">
            {/* Wordmark lime di atas hero gelap (PNG putih sebagai mask). */}
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

        {/* Kartu form mengambang - relative supaya tergambar di atas overlay hero */}
        <div className="relative -mt-10 px-4 pb-10">
          <div className="nh-card !p-6">
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (!canSubmit) return;
                void auth.login();
              }}
            >
              <div>
                <p className="nh-display text-2xl">{t("Sign in")}</p>
                <p className="mt-0.5 text-sm text-nh-muted">
                  {t("Masuk dengan username dan password.")}
                </p>
              </div>
              
              <div>
                <label className="nh-label" htmlFor="username">
                  {t("Username / No. WhatsApp / Email")}
                </label>
                <input
                  id="username"
                  className="nh-input"
                  type="text"
                  value={auth.username}
                  onChange={(e) => auth.setUsername(e.target.value)}
                  placeholder="Username Anda"
                  autoComplete="username"
                />
              </div>
              
              <div>
                <label className="nh-label" htmlFor="password">
                  {t("Password")}
                </label>
                <input
                  id="password"
                  className="nh-input"
                  type="password"
                  value={auth.password}
                  onChange={(e) => auth.setPassword(e.target.value)}
                  placeholder="******"
                  autoComplete="current-password"
                />
              </div>
              
              <button
                type="submit"
                className="nh-btn-brand flex items-center justify-center gap-2"
                disabled={auth.busy || !canSubmit}
              >
                {t("Sign in")} <ArrowRight size={18} />
              </button>
              
              {auth.error ? <p className="text-sm font-bold text-nh-danger">{auth.error}</p> : null}
            </form>
            
            <div className="mt-4">
              <GoogleSignIn onSignedIn={onSignedIn} onNeedsPhone={onNeedsPhone} />
              {googleNotice ? <p className="mt-3 text-sm text-nh-danger">{googleNotice}</p> : null}
            </div>
          </div>

          <Link href={m("/auth/register")} className="nh-btn-ghost mt-3 w-full">
            {t("Create your membership")}
          </Link>
        </div>
      </div>
    </div>
  );
}
