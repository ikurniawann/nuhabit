"use client";

import { useCallback, useEffect, useState } from "react";
import { WifiOff } from "lucide-react";
import { memberApi } from "../lib/api";
import { useT } from "../lib/i18n";

/**
 * PWA aplikasi member: service worker (/member/sw.js, scope /member) untuk
 * cache app shell + halaman offline + web push, banner offline, dan
 * berlangganan notifikasi push dari pengaturan.
 */

// Dev: service worker tanpa cache (lihat public/member-assets/sw.js), push tetap jalan.
const MEMBER_SW_URL = process.env.NODE_ENV === "production" ? "/member/sw.js" : "/member/sw.js?dev=1";
const MEMBER_SW_SCOPE = "/member";

const swSupported = () => typeof navigator !== "undefined" && "serviceWorker" in navigator;

function registerMemberSw() {
  return navigator.serviceWorker.register(MEMBER_SW_URL, { scope: MEMBER_SW_SCOPE });
}

/** Daftarkan service worker sekali saat aplikasi dibuka. */
export function useMemberServiceWorker() {
  useEffect(() => {
    if (!swSupported()) return;
    registerMemberSw().catch(() => {
      /* mode privat / browser tanpa SW: aplikasi tetap jalan tanpa cache */
    });
  }, []);
}

export function OfflineBanner() {
  const t = useT();
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  if (online) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-2 bg-nh-ink px-4 pt-[max(env(safe-area-inset-top),0.5rem)] pb-2 text-xs font-bold tracking-wider text-white uppercase"
    >
      <WifiOff size={14} className="text-nh-lime" />
      {t("Offline. What you see may be out of date.")}
    </div>
  );
}

/** Kunci VAPID base64url → Uint8Array untuk pushManager.subscribe. */
function vapidKeyToBytes(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const raw = atob((base64Url + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

type PushState = "unsupported" | "unconfigured" | "denied" | "off" | "on";

/** Status + aksi berlangganan push untuk perangkat ini. */
export function useMemberPush() {
  const [state, setState] = useState<PushState>("off");
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!swSupported() || !("PushManager" in window) || !("Notification" in window)) {
        setState("unsupported");
        return;
      }
      try {
        const info = await memberApi<{ public_key: string | null }>("/push");
        if (cancelled) return;
        if (!info.public_key) return setState("unconfigured");
        setPublicKey(info.public_key);
        if (Notification.permission === "denied") return setState("denied");
        const registration = await navigator.serviceWorker.getRegistration(MEMBER_SW_SCOPE);
        const subscription = await registration?.pushManager.getSubscription();
        if (!cancelled) setState(subscription ? "on" : "off");
      } catch {
        if (!cancelled) setState("unconfigured");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = useCallback(async () => {
    if (!publicKey) return;
    setBusy(true);
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }
      const registration = await registerMemberSw();
      await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: vapidKeyToBytes(publicKey),
        }));
      await memberApi("/push", { method: "POST", json: subscription.toJSON() });
      setState("on");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not turn on notifications");
    } finally {
      setBusy(false);
    }
  }, [publicKey]);

  const disable = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const registration = await navigator.serviceWorker.getRegistration(MEMBER_SW_SCOPE);
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await memberApi("/push", { method: "DELETE", json: { endpoint: subscription.endpoint } });
        await subscription.unsubscribe();
      }
      setState("off");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not turn off notifications");
    } finally {
      setBusy(false);
    }
  }, []);

  return { state, busy, error, enable, disable };
}
