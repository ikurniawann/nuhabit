"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { apiGet } from "@/lib/api-client";
import { COMPLAINT_CATEGORY_LABEL, COMPLAINT_SOURCE_LABEL, formatDurationHours } from "@/lib/studio/complaints";
import type { ComplaintMetrics, ComplaintReport } from "@/lib/studio/complaints-report-server";
import { todayIso } from "../types";
import { EmptyState, Field } from "./ui-bits";

/**
 * Laporan keluhan (EPIC-067 T-067-B5): ringkasan, per kategori, per coach
 * (keluhan per 100 peserta = KPI coach_complaint_rate), per sumber. Masukan
 * dari member dihitung terpisah, tiket batal tidak ikut.
 */

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);

export function ComplaintsReport() {
  const today = todayIso();
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`);
  const [to, setTo] = useState(today);
  const [data, setData] = useState<{ key: string; report: ComplaintReport } | null>(null);
  const key = `${from}|${to}`;

  useEffect(() => {
    if (!from || !to || to < from) return;
    let cancelled = false;
    apiGet<{ data: ComplaintReport }>(`/api/studio/complaints/report?from=${from}&to=${to}`)
      .then((r) => !cancelled && setData({ key, report: r.data }))
      .catch((e) => toast.error(e instanceof Error ? e.message : "Gagal memuat laporan"));
    return () => {
      cancelled = true;
    };
  }, [key, from, to]);

  const r = data && data.key === key ? data.report : null;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Dari">
          <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="Sampai">
          <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <p className="pb-2 text-xs text-muted-foreground">Berdasarkan tanggal tiket dibuat. Masukan & tiket batal tidak dihitung sebagai keluhan.</p>
      </div>

      {!r ? (
        <Loader2 className="mx-auto my-10 size-5 animate-spin text-muted-foreground" />
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Keluhan" value={String(r.summary.total)} hint={`${r.summary.open} masih terbuka · ${r.summary.escalated} dieskalasi`} />
            <Stat label="Respons rata-rata" value={formatDurationHours(r.summary.avg_respond_hours)} hint={`${pct(r.summary.respond_on_time)} tepat waktu`} />
            <Stat label="Selesai rata-rata" value={formatDurationHours(r.summary.avg_resolve_hours)} hint={`${pct(r.summary.resolve_on_time)} tepat waktu`} />
            <Stat label="Masukan member" value={String(r.summary.feedback)} hint={`${r.summary.cancelled} tiket dibatalkan`} />
          </section>

          <ReportTable
            title="Per kategori"
            empty="Belum ada keluhan di periode ini"
            head={["Kategori"]}
            rows={r.by_category.map((c) => ({ key: c.category, cells: [COMPLAINT_CATEGORY_LABEL[c.category]], m: c }))}
          />

          <section className="rounded-xl border border-border bg-card shadow-sm">
            <div className="px-4 pt-4">
              <p className="text-[13px] font-semibold text-foreground">Per coach</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Keluhan yang tertaut ke coach (langsung atau lewat sesi). &quot;Per 100 peserta&quot; dipakai KPI coach (target ≤ 1).
              </p>
            </div>
            {r.by_coach.length === 0 ? (
              <div className="p-4">
                <EmptyState title="Belum ada data coach di periode ini" />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="mt-3 w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="border-y border-border bg-secondary/40 text-left text-xs font-semibold text-muted-foreground">
                      <th className="px-4 py-2">Coach</th>
                      <th className="px-3 py-2 text-right">Keluhan</th>
                      <th className="px-3 py-2 text-right">Tentang coach</th>
                      <th className="px-3 py-2 text-right">Cedera</th>
                      <th className="px-3 py-2 text-right">Peserta</th>
                      <th className="px-3 py-2 text-right">Per 100 peserta</th>
                      <th className="px-3 py-2 text-right">Selesai rata-rata</th>
                      <th className="px-4 py-2 text-right">Masukan</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {r.by_coach.map((c) => (
                      <tr key={c.coach_id}>
                        <td className="px-4 py-2 text-foreground">{c.coach_name}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{c.total}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{c.about_coach}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{c.injury}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{c.attendees}</td>
                        <td className={`px-3 py-2 text-right font-semibold tabular-nums ${c.rate_per_100 !== null && c.rate_per_100 > 1 ? "text-destructive" : "text-foreground"}`}>
                          {c.rate_per_100 === null ? "—" : c.rate_per_100.toLocaleString("id-ID", { maximumFractionDigits: 2 })}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatDurationHours(c.avg_resolve_hours)}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{c.feedback}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <ReportTable
            title="Per sumber"
            empty="Belum ada keluhan di periode ini"
            head={["Sumber"]}
            rows={r.by_source.map((s) => ({ key: s.source, cells: [COMPLAINT_SOURCE_LABEL[s.source]], m: s }))}
          />
        </>
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-foreground">{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function ReportTable({ title, empty, head, rows }: { title: string; empty: string; head: string[]; rows: { key: string; cells: string[]; m: ComplaintMetrics }[] }) {
  return (
    <section className="rounded-xl border border-border bg-card shadow-sm">
      <p className="px-4 pt-4 text-[13px] font-semibold text-foreground">{title}</p>
      {rows.length === 0 ? (
        <div className="p-4">
          <EmptyState title={empty} />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="mt-3 w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-y border-border bg-secondary/40 text-left text-xs font-semibold text-muted-foreground">
                {head.map((h) => (
                  <th key={h} className="px-4 py-2">
                    {h}
                  </th>
                ))}
                <th className="px-3 py-2 text-right">Keluhan</th>
                <th className="px-3 py-2 text-right">Terbuka</th>
                <th className="px-3 py-2 text-right">Respons rata-rata</th>
                <th className="px-3 py-2 text-right">Selesai rata-rata</th>
                <th className="px-3 py-2 text-right">Respons tepat waktu</th>
                <th className="px-4 py-2 text-right">Selesai tepat waktu</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => (
                <tr key={row.key}>
                  {row.cells.map((c, i) => (
                    <td key={i} className="px-4 py-2 text-foreground">
                      {c}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right tabular-nums">{row.m.total}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{row.m.open}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatDurationHours(row.m.avg_respond_hours)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatDurationHours(row.m.avg_resolve_hours)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{pct(row.m.respond_on_time)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{pct(row.m.resolve_on_time)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
