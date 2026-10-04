"use client";

import { useState } from "react";
import { statusLabel, type StatusLevel } from "@/lib/desktop/status";
import { useSystemStatus } from "../../hooks/use-system-status";

const LEVEL_DOT: Record<StatusLevel, string> = {
  ok: "bg-emerald-400",
  warn: "bg-amber-300",
  down: "bg-rose-400",
  unknown: "bg-white/40",
};

/**
 * Lampu status operasional di menubar: database, antrian cetak, WhatsApp.
 * Sekali lihat kasir/owner tahu ada layanan yang mati sebelum pelanggan
 * yang memberi tahu.
 */
export function SystemStatusChip({ onOpenToday }: { onOpenToday: () => void }) {
  const { data: status } = useSystemStatus();
  const [open, setOpen] = useState(false);
  const level = status?.level ?? "unknown";

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        title={statusLabel(level)}
        aria-label={statusLabel(level)}
        className="flex items-center gap-1.5 rounded-full px-2 py-1 transition hover:bg-white/10"
      >
        <span className={`size-2 rounded-full ${LEVEL_DOT[level]}`} />
        <span className="hidden text-[11px] text-white/70 lg:inline">Status</span>
      </button>
      {open && (
        <div className="absolute right-0 top-[calc(100%+6px)] z-[90] w-64 overflow-hidden rounded-2xl border border-white/15 bg-slate-950/90 p-1.5 text-left shadow-2xl backdrop-blur-2xl">
          {(status?.items ?? []).map((item) => (
            <div key={item.key} className="flex items-start gap-2 rounded-xl px-2.5 py-2">
              <span className={`mt-1 size-2 shrink-0 rounded-full ${LEVEL_DOT[item.level]}`} />
              <span className="min-w-0">
                <span className="block text-xs font-semibold">{item.label}</span>
                <span className="block text-[11px] text-white/45">{item.detail ?? "—"}</span>
              </span>
            </div>
          ))}
          {!status && <div className="px-2.5 py-2 text-[11px] text-white/45">Memeriksa layanan…</div>}
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onOpenToday();
            }}
            className="mt-1 w-full rounded-xl bg-white/10 px-2.5 py-2 text-xs font-semibold transition hover:bg-white/18"
          >
            Buka panel Hari Ini
          </button>
        </div>
      )}
    </div>
  );
}
