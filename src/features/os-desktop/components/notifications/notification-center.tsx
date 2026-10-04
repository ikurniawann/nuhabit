"use client";

import { useEffect } from "react";
import type { ActivityNotification } from "@/lib/desktop/notifications";
import { WindowShell } from "../windows/window-shell";

function formatAt(at: string) {
  return new Date(at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}

export function NotificationCenter({
  items,
  onOpen,
  onClear,
  onClose,
}: {
  items: ActivityNotification[];
  onOpen: (n: ActivityNotification) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  return (
    <WindowShell title="Notification Center" onClose={onClose} className="right-5 top-14 w-[min(390px,calc(100vw-32px))]">
      <div className="space-y-3 p-4">
        <div className="rounded-3xl border border-white/10 bg-white/8 p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">Aktivitas</div>
              <div className="text-xs text-white/45">Kejadian terbaru di bisnis Anda</div>
            </div>
            <button
              onClick={onClear}
              className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white/60 transition hover:bg-white/16 hover:text-white"
            >
              Bersihkan
            </button>
          </div>
        </div>

        <div className="max-h-[55vh] space-y-2 overflow-y-auto">
          {items.map((n) => (
            <button
              key={n.id}
              onClick={() => onOpen(n)}
              className="block w-full rounded-3xl border border-white/10 bg-white/8 p-3 text-left text-sm text-white/72 transition hover:bg-white/12"
            >
              <div>{n.text}</div>
              <div className="mt-1 text-xs text-white/40">{formatAt(n.at)} · klik untuk membuka</div>
            </button>
          ))}
        </div>
      </div>
    </WindowShell>
  );
}

const POPUP_DISMISS_MS = 7_000;

/** Satu popup: hilang sendiri setelah 7 detik, klik = menuju modulnya. */
function NotificationPopup({
  notification: n,
  onDismiss,
  onOpen,
}: {
  notification: ActivityNotification;
  onDismiss: (id: string) => void;
  onOpen: (notification: ActivityNotification) => void;
}) {
  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(n.id), POPUP_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [n.id, onDismiss]);

  return (
    <div className="flex items-start gap-3 rounded-3xl border border-white/18 bg-slate-950/55 p-3.5 shadow-2xl backdrop-blur-2xl">
      <button onClick={() => onOpen(n)} className="min-w-0 flex-1 text-left">
        <div className="text-sm leading-5 text-white/85">{n.text}</div>
        <div className="mt-1 text-[11px] text-white/35">{formatAt(n.at)} · klik untuk membuka</div>
      </button>
      <button
        onClick={() => onDismiss(n.id)}
        aria-label="Tutup notifikasi"
        className="shrink-0 rounded-full px-1.5 text-white/40 transition hover:bg-white/10 hover:text-white"
      >
        ×
      </button>
    </div>
  );
}

/** Tumpukan popup di kanan atas (lib/activity-feed menyimpan maksimal empat). */
export function NotificationPopups({
  popups,
  onDismiss,
  onOpen,
}: {
  popups: ActivityNotification[];
  onDismiss: (id: string) => void;
  onOpen: (notification: ActivityNotification) => void;
}) {
  if (popups.length === 0) return null;
  return (
    <div className="fixed right-5 top-12 z-[80] flex w-[min(340px,calc(100vw-32px))] flex-col gap-2">
      {popups.map((n) => (
        <NotificationPopup key={n.id} notification={n} onDismiss={onDismiss} onOpen={onOpen} />
      ))}
    </div>
  );
}
