"use client";

import dynamic from "next/dynamic";

/**
 * Pemuat desktop Arkiv OS secara lazy (audit performa 2026-09-17).
 *
 * arkiv-os-desktop.tsx besar (ribuan baris + drag-drop, monitoring, export,
 * dataroom, notifikasi). Diimpor langsung, seluruhnya masuk JS awal route dan
 * memperlambat parse/hydration di perangkat kasir. Di sini ia dipecah jadi
 * chunk terpisah yang dimuat setelah shell tampil; splash muncul lebih dulu.
 * ssr:false — desktop murni interaktif klien (window manager, localStorage).
 */
const ArkivOsDesktop = dynamic(() => import("./arkiv-os-desktop"), {
  ssr: false,
  loading: () => (
    <div className="grid min-h-dvh place-items-center bg-ink text-white">
      <div className="flex flex-col items-center gap-4">
        <div className="size-12 animate-spin rounded-full border-2 border-white/20 border-t-pink-400" />
        <div className="text-sm font-medium text-white/70">Memuat NüHabit OS…</div>
      </div>
    </div>
  ),
});

export default function ArkivOsDesktopLoader() {
  return <ArkivOsDesktop />;
}
