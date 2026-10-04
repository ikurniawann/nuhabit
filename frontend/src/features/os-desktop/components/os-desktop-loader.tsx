"use client";

import dynamic from "next/dynamic";
import { brandOsName } from "@/lib/branding";

/**
 * Desktop dimuat sebagai chunk terpisah setelah shell tampil (audit performa
 * 2026-09-17): diimpor langsung, seluruhnya masuk JS awal route dan
 * memperlambat parse/hydration di perangkat kasir. ssr:false karena desktop
 * murni interaktif klien (window manager, localStorage).
 */
const OsDesktop = dynamic(() => import("./os-desktop"), {
  ssr: false,
  loading: () => (
    <div className="grid min-h-dvh place-items-center bg-ink text-white">
      <div className="flex flex-col items-center gap-4">
        <div className="size-12 animate-spin rounded-full border-2 border-white/20 border-t-pink-400" />
        <div className="text-sm font-medium text-white/70">Memuat {brandOsName()}…</div>
      </div>
    </div>
  ),
});

export function OsDesktopLoader() {
  return <OsDesktop />;
}
