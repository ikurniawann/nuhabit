"use client";

import { formatDate } from "@/lib/format";
import { useMemo, useState } from "react";
import {
  CalendarDays,
  Filter,
  Loader2,
  TrendingDown,
  TrendingUp,
  Trophy,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EVENT_TYPE_LABELS, formatRupiahOrDash } from "../../pipeline/types";
import { ORG_TYPE_LABELS, SOURCE_LABELS } from "../../leads/types";
import { useFunnelReport } from "../queries";
import type { BreakdownRow, ReportFilters } from "../types";

const dayMs = 24 * 60 * 60 * 1000;
const isoDaysAgo = (days: number) =>
  new Date(Date.now() - days * dayMs).toISOString().slice(0, 10);

function pct(part: number, whole: number): string {
  if (whole <= 0) return "—";
  return `${Math.round((part / whole) * 100)}%`;
}

function labelFor(section: string, key: string): string {
  if (section === "org")
    return ORG_TYPE_LABELS[key as keyof typeof ORG_TYPE_LABELS] ?? key;
  if (section === "event")
    return EVENT_TYPE_LABELS[key as keyof typeof EVENT_TYPE_LABELS] ?? key;
  if (section === "source")
    return SOURCE_LABELS[key as keyof typeof SOURCE_LABELS] ?? key;
  return key;
}

function BreakdownTable({
  title,
  section,
  rows,
}: {
  title: string;
  section: string;
  rows: BreakdownRow[];
}) {
  return (
    <div className="rounded-2xl border border-gray-200/70 bg-white p-4">
      <p className="mb-3 text-sm font-semibold text-gray-900">{title}</p>
      {rows.length === 0 ? (
        <p className="py-4 text-center text-xs text-gray-400">Belum ada data.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-wide text-gray-400">
              <th className="pb-2 text-left font-medium">&nbsp;</th>
              <th className="pb-2 text-right font-medium">Deal</th>
              <th className="pb-2 text-right font-medium">Menang</th>
              <th className="pb-2 text-right font-medium">Nilai Menang</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((row) => (
              <tr key={row.key}>
                <td className="py-2 text-gray-900">{labelFor(section, row.key)}</td>
                <td className="py-2 text-right text-gray-600">
                  {Number(row.total)}
                </td>
                <td className="py-2 text-right text-emerald-700">
                  {Number(row.won)}
                </td>
                <td className="py-2 text-right font-medium text-gray-900">
                  {formatRupiahOrDash(row.won_value)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function SalesFunnelReportsPage() {
  const [from, setFrom] = useState(isoDaysAgo(90));
  const [to, setTo] = useState(isoDaysAgo(0));

  const filters: ReportFilters = useMemo(() => ({ from, to }), [from, to]);
  const reportQuery = useFunnelReport(filters);
  const report = reportQuery.data;

  const funnel = report?.funnel ?? [];
  const maxReached = Math.max(1, ...funnel.map((s) => Number(s.reached)));
  const summary = report?.summary;
  const winRate =
    summary && summary.won + summary.lost > 0
      ? pct(summary.won, summary.won + summary.lost)
      : "—";

  return (
    <div className="space-y-6">
      {/* ── Header + periode ── */}
      <div className="flex flex-col gap-4 border-b border-gray-200/70 pb-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Laporan Funnel</h1>
          <p className="mt-1 text-sm text-gray-500">
            Conversion, win rate, dan breakdown deal B2B per periode.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Filter className="h-4 w-4 text-gray-400" />
          <Input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="h-9 w-40 bg-white text-sm"
          />
          <span className="text-sm text-gray-400">s/d</span>
          <Input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="h-9 w-40 bg-white text-sm"
          />
          {[30, 90].map((days) => (
            <Button
              key={days}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setFrom(isoDaysAgo(days));
                setTo(isoDaysAgo(0));
              }}
              className="h-9 rounded-lg border-gray-200/80 text-xs"
            >
              {days} hari
            </Button>
          ))}
        </div>
      </div>

      {reportQuery.isLoading ? (
        <div className="py-20 text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-pink-600" />
          <p className="mt-2 text-sm text-gray-500">Menghitung laporan...</p>
        </div>
      ) : reportQuery.isError || !report ? (
        <div className="py-20 text-center">
          <p className="text-gray-500">
            {reportQuery.error instanceof Error
              ? reportQuery.error.message
              : "Gagal memuat laporan"}
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => reportQuery.refetch()}
            className="mt-3 h-9 rounded-lg"
          >
            Coba Lagi
          </Button>
        </div>
      ) : (
        <>
          {/* ── KPI ── */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              {
                icon: Trophy,
                tone: "bg-emerald-100 text-emerald-700",
                label: "Win Rate",
                value: winRate,
                hint: `${summary?.won ?? 0} menang · ${summary?.lost ?? 0} kalah (ditutup dalam periode)`,
              },
              {
                icon: Wallet,
                tone: "bg-pink-100 text-pink-700",
                label: "Nilai Booking",
                value: formatRupiahOrDash(summary?.won_value),
                hint: "total nilai final deal menang dalam periode",
              },
              {
                icon: TrendingUp,
                tone: "bg-blue-100 text-blue-700",
                label: "Pipeline Berjalan",
                value: formatRupiahOrDash(summary?.pipeline_value),
                hint: `${summary?.open_count ?? 0} deal terbuka saat ini`,
              },
              {
                icon: TrendingDown,
                tone: "bg-amber-100 text-amber-700",
                label: "Deal Baru",
                value: String(summary?.total_created ?? 0),
                hint: "deal dibuat dalam periode",
              },
            ].map((card) => (
              <div
                key={card.label}
                className="rounded-2xl border border-gray-200/70 bg-white p-4"
              >
                <div
                  className={`mb-2.5 flex h-9 w-9 items-center justify-center rounded-lg ${card.tone}`}
                >
                  <card.icon className="h-5 w-5" />
                </div>
                <p className="text-lg font-bold text-gray-900">{card.value}</p>
                <p className="text-sm text-gray-600">{card.label}</p>
                <p className="mt-0.5 text-xs text-gray-400">{card.hint}</p>
              </div>
            ))}
          </div>

          {/* ── Funnel conversion ── */}
          <div className="rounded-2xl border border-gray-200/70 bg-white p-5">
            <p className="mb-1 text-sm font-semibold text-gray-900">
              Funnel Conversion per Tahap
            </p>
            <p className="mb-4 text-xs text-gray-400">
              Jumlah deal (dibuat dalam periode) yang pernah mencapai tiap
              tahap; persentase = konversi dari tahap sebelumnya.
            </p>
            <div className="space-y-2.5">
              {funnel.map((stage, index) => {
                const reached = Number(stage.reached);
                const prev = index > 0 ? Number(funnel[index - 1].reached) : null;
                return (
                  <div key={stage.id} className="flex items-center gap-3">
                    <div className="w-40 shrink-0 truncate text-sm text-gray-700">
                      {stage.name}
                    </div>
                    <div className="h-7 flex-1 overflow-hidden rounded-lg bg-gray-100">
                      <div
                        className={`flex h-full items-center rounded-lg px-2 text-xs font-semibold text-white ${
                          stage.is_won ? "bg-emerald-500" : "bg-pink-500"
                        }`}
                        style={{
                          width:
                            reached === 0
                              ? "0%"
                              : `${Math.max(4, (reached / maxReached) * 100)}%`,
                        }}
                      >
                        {reached > 0 ? reached : null}
                      </div>
                    </div>
                    <div className="w-14 shrink-0 text-right text-xs text-gray-500">
                      {prev !== null ? pct(reached, prev) : "100%"}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Breakdown ── */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <BreakdownTable
              title="Per Jenis Instansi"
              section="org"
              rows={report.by_org_type}
            />
            <BreakdownTable
              title="Per Jenis Acara"
              section="event"
              rows={report.by_event_type}
            />
            <BreakdownTable
              title="Per Sumber Lead"
              section="source"
              rows={report.by_source}
            />
            <BreakdownTable
              title="Leaderboard Penanggung Jawab"
              section="owner"
              rows={report.by_owner}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* ── Kalender booked ── */}
            <div className="rounded-2xl border border-gray-200/70 bg-white p-4">
              <p className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-gray-900">
                <CalendarDays className="h-4 w-4 text-emerald-600" />
                Acara Ter-booking ke Depan
              </p>
              {report.upcoming_events.length === 0 ? (
                <p className="py-4 text-center text-xs text-gray-400">
                  Belum ada acara terjadwal.
                </p>
              ) : (
                <ul className="space-y-2">
                  {report.upcoming_events.map((event) => (
                    <li
                      key={event.id}
                      className="flex items-start justify-between gap-2 rounded-xl border border-gray-200/70 p-3 text-sm"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900">{event.title}</p>
                        <p className="text-xs text-gray-500">
                          {event.org_name} ·{" "}
                          {EVENT_TYPE_LABELS[
                            event.event_type as keyof typeof EVENT_TYPE_LABELS
                          ] ?? event.event_type}
                          {event.pax_estimate ? ` · ${event.pax_estimate} pax` : ""}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <Badge className="border-0 bg-emerald-100 font-normal text-emerald-700">
                          {formatDate(event.event_date)}
                        </Badge>
                        <p className="mt-1 text-xs font-semibold text-gray-900">
                          {formatRupiahOrDash(event.value_final)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* ── Rekap alasan kalah ── */}
            <div className="rounded-2xl border border-gray-200/70 bg-white p-4">
              <p className="mb-3 text-sm font-semibold text-gray-900">
                Rekap Alasan Kalah
              </p>
              {report.lost_reasons.length === 0 ? (
                <p className="py-4 text-center text-xs text-gray-400">
                  Tidak ada deal kalah dalam periode — mantap! 🎉
                </p>
              ) : (
                <ul className="space-y-2">
                  {report.lost_reasons.map((reason) => {
                    const total = Number(reason.total);
                    const maxLost = Math.max(
                      1,
                      ...report.lost_reasons.map((r) => Number(r.total))
                    );
                    return (
                      <li key={reason.key} className="flex items-center gap-3">
                        <div className="w-36 shrink-0 truncate text-sm text-gray-700">
                          {reason.key}
                        </div>
                        <div className="h-6 flex-1 overflow-hidden rounded-lg bg-gray-100">
                          <div
                            className="flex h-full items-center rounded-lg bg-red-400 px-2 text-xs font-semibold text-white"
                            style={{
                              width: `${Math.max(6, (total / maxLost) * 100)}%`,
                            }}
                          >
                            {total}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
