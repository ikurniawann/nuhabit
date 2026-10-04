"use client";

import { useCallback, useEffect, useState } from "react";
import { ClipboardList, Expand, Home, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";

const HOME_HREF = "/dashboard";

export const POS_CHROME_BUTTON_CLASS =
  "border-gray-200/80 text-gray-700 hover:border-primary/30 hover:bg-primary/10 hover:text-brand-text";

type Props = {
  className?: string;
  /** Immersive POS shell (tanpa sidebar dashboard). */
  immersive?: boolean;
  onToggleImmersive?: (next: boolean) => void;
  /** Pintasan Riwayat Transaksi / Orders. */
  ordersHref?: string;
};

/**
 * Chrome POS: Beranda + layar penuh (sembunyikan sidebar + Fullscreen API).
 */
export function PosTabletChromeControls({
  className,
  immersive = false,
  onToggleImmersive,
  ordersHref,
}: Props) {
  const [isBrowserFullscreen, setIsBrowserFullscreen] = useState(false);

  useEffect(() => {
    function sync() {
      setIsBrowserFullscreen(Boolean(document.fullscreenElement));
    }
    sync();
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  const expanded = immersive || isBrowserFullscreen;

  const goHome = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
    } catch {
      // ignore
    }
    // POS layout → (dashboard) layout: soft router.push memicu RSC TypeError.
    window.location.assign(new URL(HOME_HREF, window.location.origin).href);
  }, []);

  const toggle = useCallback(async () => {
    if (expanded) {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
      } catch {
        // ignore
      }
      onToggleImmersive?.(false);
      return;
    }
    try {
      await document.documentElement.requestFullscreen();
    } catch {
      // PWA / tablet sering menolak FS; shell tanpa sidebar tetap dipakai
    }
    onToggleImmersive?.(true);
  }, [expanded, onToggleImmersive]);

  return (
    <div className={className ?? "flex flex-wrap items-center gap-2"}>
      {ordersHref ? (
        <Button
          type="button"
          variant="outline"
          className={POS_CHROME_BUTTON_CLASS}
          onClick={() => window.location.assign(ordersHref)}
          title="Riwayat Transaksi"
        >
          <ClipboardList className="mr-2 h-4 w-4" />
          Riwayat Transaksi
        </Button>
      ) : null}
      {immersive ? (
        <Button
          type="button"
          variant="outline"
          className={POS_CHROME_BUTTON_CLASS}
          onClick={() => void goHome()}
          title="Kembali ke Beranda"
        >
          <Home className="mr-2 h-4 w-4" />
          Beranda
        </Button>
      ) : null}
      <Button
        type="button"
        variant="outline"
        className={POS_CHROME_BUTTON_CLASS}
        onClick={() => void toggle()}
        title={expanded ? "Kembali ke tampilan biasa" : "Layar penuh tanpa sidebar"}
      >
        {expanded ? (
          <>
            <Minimize2 className="mr-2 h-4 w-4" />
            Keluar layar penuh
          </>
        ) : (
          <>
            <Expand className="mr-2 h-4 w-4" />
            Layar penuh
          </>
        )}
      </Button>
    </div>
  );
}
