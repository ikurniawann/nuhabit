"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarDays, Download, FileSpreadsheet, Loader2 } from "lucide-react";
import { REPORT_EXPORTS, type ReportExportKey } from "@/lib/pos/report-excel/builders";
import {
  REPORT_PERIOD_LABELS,
  REPORT_PERIOD_SHORTCUTS,
  resolveReportPeriod,
  type ReportPeriodShortcut,
} from "@/lib/pos/report-period";
import { useReportDownload } from "../../hooks/use-drive";

const REPORT_KEYS = Object.keys(REPORT_EXPORTS) as ReportExportKey[];

/**
 * Drive → Reports (owner 2026-09-05): klik laporan → pilih rentang tanggal
 * (pintasan Hari ini / Minggu ini / Bulan ini / Tahun ini) → unduh Excel
 * rapi dari /api/pos/reports/export. Butuh login (sesi dashboard).
 */
export function ReportsExplorer({ isLoggedIn }: { isLoggedIn: boolean }) {
  const [selected, setSelected] = useState<ReportExportKey | null>(null);
  const [shortcut, setShortcut] = useState<ReportPeriodShortcut | null>("month");
  const [range, setRange] = useState(() => resolveReportPeriod("month"));
  const panelRef = useRef<HTMLDivElement>(null);
  const download = useReportDownload();

  // Panel tanggal ada di bawah daftar laporan → gulirkan ke panel saat laporan dipilih.
  useEffect(() => {
    if (selected) panelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selected]);

  const pickShortcut = (key: ReportPeriodShortcut) => {
    setShortcut(key);
    setRange(resolveReportPeriod(key));
    download.reset();
  };
  const setManual = (patch: Partial<{ date_from: string; date_to: string }>) => {
    setShortcut(null);
    setRange((prev) => ({ ...prev, ...patch }));
    download.reset();
  };
  const startDownload = () => {
    if (!selected || download.isPending) return;
    download.mutate({ report: selected, dateFrom: range.date_from, dateTo: range.date_to });
  };

  const message = download.error
    ? { kind: "error" as const, text: download.error.message || "Gagal mengunduh" }
    : download.data
      ? { kind: "ok" as const, text: `${download.data} terunduh` }
      : null;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {REPORT_KEYS.map((key) => {
          const meta = REPORT_EXPORTS[key];
          const active = selected === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => {
                setSelected(key);
                download.reset();
              }}
              className={`flex items-center gap-3 rounded-3xl border p-4 text-left transition ${active ? "border-pink-300/70 bg-pink-500/20 ring-1 ring-pink-300/60" : "border-white/10 bg-white/8 hover:bg-white/12"}`}
            >
              <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-accent text-accent-foreground"><FileSpreadsheet className="size-5" /></div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{meta.label}</div>
                <div className="mt-1 line-clamp-2 text-xs text-white/45">{meta.description}</div>
              </div>
            </button>
          );
        })}
      </div>

      {selected ? (
        <div ref={panelRef} className="arkiv-drive-filter rounded-3xl border border-white/10 bg-white/8 p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <CalendarDays className="size-4 text-pink-200" /> Rentang tanggal — {REPORT_EXPORTS[selected].label}
          </div>
          <div className="mb-3 flex flex-wrap gap-2">
            {REPORT_PERIOD_SHORTCUTS.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => pickShortcut(key)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${shortcut === key ? "border-pink-300/70 bg-pink-500/30 text-white" : "border-white/10 bg-white/8 text-white/70 hover:bg-white/12"}`}
              >
                {REPORT_PERIOD_LABELS[key]}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-white/60">
              Dari
              <input type="date" value={range.date_from} max={range.date_to} onChange={(e) => setManual({ date_from: e.target.value })} className="arkiv-drive-date mt-1 block rounded-xl border border-white/15 px-3 py-2 text-sm font-semibold outline-none focus:border-pink-300/70" />
            </label>
            <label className="text-xs text-white/60">
              Sampai
              <input type="date" value={range.date_to} min={range.date_from} onChange={(e) => setManual({ date_to: e.target.value })} className="arkiv-drive-date mt-1 block rounded-xl border border-white/15 px-3 py-2 text-sm font-semibold outline-none focus:border-pink-300/70" />
            </label>
            <button
              type="button"
              onClick={startDownload}
              disabled={!isLoggedIn || download.isPending}
              className="inline-flex items-center gap-2 rounded-2xl bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground shadow-lg transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {download.isPending ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              {download.isPending ? "Menyiapkan Excel…" : "Download Excel"}
            </button>
          </div>
          <p className={`mt-3 text-xs ${message?.kind === "error" ? "text-rose-300" : message ? "text-emerald-300" : "text-white/45"}`}>
            {message?.text ?? (isLoggedIn ? "File Excel rapi: judul, ringkasan, tabel berkepala, format Rupiah, beberapa sheet." : "Login dulu untuk mengunduh laporan.")}
          </p>
        </div>
      ) : (
        <div className="rounded-3xl border border-dashed border-white/15 bg-white/5 p-4 text-sm text-white/55">
          Pilih laporan di atas, tentukan rentang tanggal, lalu unduh sebagai Excel.
        </div>
      )}
    </div>
  );
}
