"use client";

import { useState, type ComponentType, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { PERIOD_KINDS, PERIOD_LABELS, type PeriodKind } from "@/lib/desktop/period";
import { MONITOR_WIDGETS, normalizeWidgetOrder, type MonitorWidgetKey } from "@/lib/desktop/widgets";
import type { OverviewState } from "../../hooks/use-desktop-overview";
import { formatTanggalPendek } from "../../lib/format";
import { CARD, MonitorSkeleton, type CardContext } from "./monitor-card";
import { DecisionsCard, MemberCard, StockCard, TeamCard } from "./operations-cards";
import { GuestsCard, PromoCard, PulseCard, RevenueCard } from "./sales-cards";

/**
 * Papan widget monitoring owner di desktop NüHabit OS (EPIC-019 Fase B).
 * Tanpa ikon; permukaan kartu disamakan dengan Calendar Widget.
 */

const CARDS: Record<MonitorWidgetKey, ComponentType<CardContext>> = {
  omzet: RevenueCard,
  promo: PromoCard,
  tamu: GuestsCard,
  pulsa: PulseCard,
  tim: TeamCard,
  keputusan: DecisionsCard,
  stok: StockCard,
  member: MemberCard,
};

/**
 * Switcher periode di level papan: satu kontrol untuk semua widget. Baris
 * ringkasannya menunjukkan jendela pembanding, karena "naik 12%" tanpa
 * keterangan dibanding apa tidak bisa ditindaklanjuti.
 */
function PeriodSwitcher({ periode, onPilih, state }: { periode: PeriodKind; onPilih: (next: PeriodKind) => void; state: OverviewState }) {
  const meta = state.data?.periode;
  return (
    <div className={`${CARD} col-span-full p-3`}>
      <div className="flex flex-wrap gap-1">
        {PERIOD_KINDS.map((kind) => {
          const aktif = kind === periode;
          return (
            <button
              key={kind}
              type="button"
              onClick={() => onPilih(kind)}
              aria-pressed={aktif}
              className={`rounded-full px-3 py-1.5 text-[11px] font-bold transition ${aktif ? "bg-white text-slate-950" : "border border-white/18 text-white/70 hover:text-white"}`}
            >
              {PERIOD_LABELS[kind]}
            </button>
          );
        })}
      </div>

      {meta && (
        <div className="mt-2.5 text-[10px] leading-relaxed text-white/40">
          {formatTanggalPendek(meta.periode.mulai)}–{formatTanggalPendek(meta.periode.selesai)} · dibanding{" "}
          {formatTanggalPendek(meta.banding.mulai)}–{formatTanggalPendek(meta.banding.selesai)}
          {/* Jendela pembanding lebih pendek (mis. 31 Mar vs Feb) harus dikatakan. */}
          {!meta.banding.penuh && (
            <span className="text-amber-300/80">
              {" "}
              · pembanding hanya {meta.banding.hariBanding} hari, periode ini {meta.periode.hariBerjalan} hari
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Panel monitoring versi layar kecil. Menubar tetap terlihat dan dock tetap
 * bisa ditekan; "Tutup" menampilkan desktop, pil "Monitoring" membukanya lagi.
 * Terbuka secara default: monitoring adalah alasan utama owner membuka
 * desktop dari HP.
 */
function MobileMonitorSheet({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(true);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-24 right-4 z-[25] rounded-full border border-white/18 bg-slate-950/75 px-4 py-2.5 text-xs font-bold text-white shadow-2xl backdrop-blur-2xl lg:hidden"
      >
        Monitoring
      </button>
    );
  }

  return (
    <div className="fixed inset-x-0 bottom-0 top-9 z-[25] overflow-y-auto overscroll-contain bg-ink/85 backdrop-blur-xl lg:hidden">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-black/35 px-4 py-3 backdrop-blur-2xl">
        <div>
          <div className="text-sm font-bold">Monitoring</div>
          <div className="text-[11px] text-white/40">Diperbarui tiap 60 detik</div>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-full border border-white/14 bg-white/8 px-3 py-1.5 text-xs font-semibold text-white/70 transition hover:bg-white/16 hover:text-white"
        >
          Tutup
        </button>
      </div>
      <div className="grid grid-cols-1 content-start gap-3 px-4 pb-32 pt-4">{children}</div>
    </div>
  );
}

export function MonitorBoard({
  state,
  visibility,
  order,
  periode,
  onPilihPeriode,
  onAskDo,
  onOpenInbox,
}: {
  state: OverviewState;
  visibility: Record<MonitorWidgetKey, boolean>;
  /** Urutan render pilihan user; key hilang jatuh ke urutan default. */
  order: MonitorWidgetKey[];
  periode: PeriodKind;
  onPilihPeriode: (next: PeriodKind) => void;
  onAskDo: (prompt: string) => void;
  /** Buka panel Hari Ini berisi daftar keputusan yang bisa ditindaklanjuti. */
  onOpenInbox: () => void;
}) {
  const router = useRouter();

  if (state.status === "forbidden") return null;
  if (!MONITOR_WIDGETS.some((w) => visibility[w.key])) return null;

  const d = state.data;
  const context: CardContext | null = d && {
    d,
    periode,
    failed: new Set(d.gagal ?? []),
    go: (href) => router.push(href),
    onAskDo,
    onOpenInbox,
  };

  const cards = (
    <>
      <PeriodSwitcher periode={periode} onPilih={onPilihPeriode} state={state} />
      {state.status === "loading" && (
        <>
          <MonitorSkeleton wide />
          <MonitorSkeleton />
          <MonitorSkeleton />
        </>
      )}
      {state.status === "error" && (
        <div className={`${CARD} col-span-2 p-4 text-xs text-white/60`}>Ringkasan monitoring belum bisa dimuat — dicoba lagi otomatis.</div>
      )}
      {context &&
        normalizeWidgetOrder(order)
          .filter((key) => visibility[key])
          .map((key) => {
            const Card = CARDS[key];
            return <Card key={key} {...context} />;
          })}
    </>
  );

  return (
    <>
      {/* Laptop: papan menempel di kanan seperti widget macOS; satu kolom
          sempit di lg, dua kolom lebar mulai xl. */}
      <section
        aria-label="Papan monitoring bisnis"
        className="pointer-events-auto fixed right-5 top-12 z-20 hidden max-h-[calc(100vh-140px)] w-[340px] grid-cols-1 content-start gap-3 overflow-y-auto pr-1 lg:grid xl:w-[560px] xl:grid-cols-2"
      >
        {cards}
      </section>
      <MobileMonitorSheet>{cards}</MobileMonitorSheet>
    </>
  );
}
