"use client";

import type { ReactNode } from "react";
import type { DesktopOverview } from "@/lib/desktop/overview";
import type { PeriodKind } from "@/lib/desktop/period";
import { deltaPct } from "../../lib/format";

/** Permukaan kartu, identik dengan WindowShell/Calendar Widget. */
export const CARD = "rounded-3xl border border-white/18 bg-slate-950/55 shadow-2xl backdrop-blur-2xl";

/** Yang dibutuhkan setiap kartu monitoring. */
export type CardContext = {
  d: DesktopOverview;
  periode: PeriodKind;
  failed: Set<string>;
  go: (href: string) => void;
  onAskDo: (prompt: string) => void;
  onOpenInbox?: () => void;
};

/** Kerangka kartu (tanpa ikon): judul, tombol Tanya Do & Buka, isi atau pesan gagal. */
export function MonitorCard({
  title,
  subtitle,
  href,
  onGo,
  onAskDo,
  askDoPrompt,
  children,
  failed,
  wide = false,
}: {
  title: string;
  subtitle: string;
  href: string;
  onGo: (href: string) => void;
  onAskDo: (prompt: string) => void;
  askDoPrompt: string;
  children: ReactNode;
  failed: boolean;
  wide?: boolean;
}) {
  return (
    <article className={`${CARD} p-4 ${wide ? "col-span-full" : ""}`}>
      <div className="mb-3 flex items-start gap-2">
        <div className="min-w-0">
          <div className="text-[13px] font-bold leading-tight">{title}</div>
          <div className="truncate text-[11px] text-white/40">{subtitle}</div>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => onAskDo(askDoPrompt)}
            className="rounded-full border border-pink-400/35 bg-pink-500/15 px-2.5 py-1 text-[11px] font-semibold text-pink-100 transition hover:bg-pink-500/28"
          >
            Tanya Do
          </button>
          <button
            type="button"
            onClick={() => onGo(href)}
            className="rounded-full border border-white/14 bg-white/8 px-2.5 py-1 text-[11px] font-semibold text-white/55 transition hover:bg-white/16 hover:text-white"
          >
            Buka ›
          </button>
        </div>
      </div>
      {failed ? (
        <div className="rounded-2xl bg-rose-500/10 px-3 py-2.5 text-xs text-rose-200">Data tak terjangkau — dicoba lagi otomatis.</div>
      ) : (
        children
      )}
    </article>
  );
}

export function MonitorSkeleton({ wide = false }: { wide?: boolean }) {
  return (
    <div className={`${CARD} p-4 ${wide ? "col-span-full" : ""}`}>
      <div className="h-3.5 w-1/2 animate-pulse rounded-md bg-white/15" />
      <div className="mt-3 h-8 w-2/3 animate-pulse rounded-md bg-white/12" />
      <div className="mt-2 h-3 w-3/4 animate-pulse rounded-md bg-white/10" />
    </div>
  );
}

/** Persen kecil di samping angka pembanding (kemarin / minggu lalu). */
export function MiniDelta({ current, base }: { current: number; base: number }) {
  const pct = deltaPct(current, base);
  if (pct === null) return null;
  const up = pct >= 0;
  return (
    <span className={`ml-1 text-[10px] font-bold ${up ? "text-emerald-300" : "text-rose-300"}`}>
      {up ? "▲" : "▼"}
      {Math.abs(pct)}%
    </span>
  );
}
