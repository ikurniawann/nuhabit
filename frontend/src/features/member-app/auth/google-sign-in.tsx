"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "../lib/i18n";

/** Identitas Google yang belum punya member: lanjut ke pendaftaran dengan tiket. */
export interface GoogleNeedsPhone {
  ticket: string;
  email: string;
  name: string;
}

type GoogleResponse =
  | { status: "signed_in"; name: string | null }
  | ({ status: "needs_phone"; google_sub: string } & GoogleNeedsPhone);

interface GsiButtonConfig {
  theme: "outline" | "filled_black";
  size: "large";
  width: number;
  text: "signin_with" | "continue_with";
  shape: "pill";
  locale: string;
}

interface GsiApi {
  accounts: {
    id: {
      initialize: (config: { client_id: string; callback: (r: { credential: string }) => void }) => void;
      renderButton: (parent: HTMLElement, config: GsiButtonConfig) => void;
    };
  };
}

declare global {
  interface Window {
    google?: GsiApi;
  }
}

const GSI_SRC = "https://accounts.google.com/gsi/client";
const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";

/** Memuat Google Identity Services sekali; resolve saat window.google siap. */
function loadGsi(): Promise<GsiApi> {
  if (window.google) return Promise.resolve(window.google);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SRC}"]`);
    const script = existing ?? document.createElement("script");
    const done = () => (window.google ? resolve(window.google) : reject(new Error("gsi")));
    script.addEventListener("load", done);
    script.addEventListener("error", () => reject(new Error("gsi")));
    if (!existing) {
      script.src = GSI_SRC;
      script.async = true;
      document.head.appendChild(script);
    }
  });
}

/**
 * Tombol "Masuk dengan Google" (GIS). Tampil hanya bila
 * NEXT_PUBLIC_GOOGLE_CLIENT_ID diisi. Token ID dikirim ke
 * POST /api/member-portal/auth/google; member yang dikenal langsung masuk,
 * yang belum dikenal diarahkan melengkapi nomor WhatsApp.
 */
export function GoogleSignIn({
  onSignedIn,
  onNeedsPhone,
  text = "signin_with",
}: {
  onSignedIn: () => void;
  onNeedsPhone: (identity: GoogleNeedsPhone) => void;
  text?: GsiButtonConfig["text"];
}) {
  const t = useT();
  const slot = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!CLIENT_ID || !slot.current) return;
    let cancelled = false;
    const parent = slot.current;
    loadGsi()
      .then((google) => {
        if (cancelled) return;
        google.accounts.id.initialize({
          client_id: CLIENT_ID,
          callback: async ({ credential }) => {
            setBusy(true);
            setError("");
            try {
              const res = await fetch("/api/member-portal/auth/google", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id_token: credential }),
              });
              const json = (await res.json()) as { success: boolean; error?: string; data?: GoogleResponse };
              if (!res.ok || !json.success || !json.data) throw new Error(json.error || t("Google sign-in failed."));
              if (json.data.status === "signed_in") onSignedIn();
              else onNeedsPhone({ ticket: json.data.ticket, email: json.data.email, name: json.data.name });
            } catch (e) {
              setError(e instanceof Error ? e.message : t("Google sign-in failed."));
            } finally {
              setBusy(false);
            }
          },
        });
        google.accounts.id.renderButton(parent, {
          theme: "outline",
          size: "large",
          width: Math.min(parent.clientWidth || 320, 400),
          text,
          shape: "pill",
          locale: "id",
        });
      })
      .catch(() => setError(t("Google sign-in is unavailable right now.")));
    return () => {
      cancelled = true;
    };
  }, [onSignedIn, onNeedsPhone, t, text]);

  if (!CLIENT_ID) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3 text-xs font-bold tracking-wider text-nh-muted uppercase">
        <span className="h-px flex-1 bg-nh-line" />
        {t("or")}
        <span className="h-px flex-1 bg-nh-line" />
      </div>
      <div ref={slot} className={`flex min-h-11 justify-center ${busy ? "pointer-events-none opacity-60" : ""}`} />
      {error ? <p className="text-center text-sm font-bold text-nh-danger">{error}</p> : null}
    </div>
  );
}
