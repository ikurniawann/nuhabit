"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Headset,
  Loader2,
  MessageCircle,
  Star,
  Timer,
} from "lucide-react";
import { CATEGORY_LABELS, PRIORITY_LABELS, formatDuration } from "@/lib/crm/cs-rules";
import { useCsReport } from "../queries";
import type { CrmReportPeriodInput } from "../types";
import { formatNumber } from "@/lib/format";

/**
 * EPIC-012 Fase E — bagian laporan customer service pada halaman Laporan CRM,
 * dipecah per kanal sejak EPIC-013 Fase B.
 * Hanya angka agregat; isi chat & nomor customer sengaja tidak ditampilkan.
 */

function labelKategori(category: string) {
  if (category === "belum_dikategorikan") return "Belum dikategorikan";
  return CATEGORY_LABELS[category as keyof typeof CATEGORY_LABELS] ?? category;
}

export function CsReportSection({ period }: { period: CrmReportPeriodInput }) {
  const csQuery = useCsReport(period);
  const data = csQuery.data ?? null;
  const loading = csQuery.isLoading || csQuery.isFetching;
  const error = csQuery.error instanceof Error ? csQuery.error.message : null;

  const summary = data?.summary;
  const resolvedRate =
    summary && summary.total_conversations > 0
      ? Math.round((summary.total_resolved / summary.total_conversations) * 100)
      : 0;
  const maxDaily = Math.max(1, ...(data?.daily ?? []).map((row) => row.conversations));

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
        <Headset className="size-5 text-violet-600" />
        <h2 className="text-lg font-semibold text-slate-950">Customer Service</h2>
        {loading && <Loader2 className="size-4 animate-spin text-slate-400" />}
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={MessageCircle}
          tone="text-sky-700 bg-sky-50"
          label="Percakapan"
          value={formatNumber(summary?.total_conversations ?? 0)}
          hint={`${formatNumber(summary?.total_complaints ?? 0)} ditandai komplain`}
        />
        <MetricCard
          icon={Timer}
          tone="text-violet-700 bg-violet-50"
          label="Rata-rata respons pertama"
          value={formatDuration(summary?.avg_first_response_seconds ?? null)}
          hint={`${formatNumber(summary?.total_sla_breached ?? 0)} lewat SLA`}
        />
        <MetricCard
          icon={CheckCircle2}
          tone="text-emerald-700 bg-emerald-50"
          label="Selesai"
          value={`${formatNumber(summary?.total_resolved ?? 0)} (${resolvedRate}%)`}
          hint={`Rata-rata ${formatDuration(summary?.avg_resolution_seconds ?? null)}`}
        />
        <MetricCard
          icon={Star}
          tone="text-amber-700 bg-amber-50"
          label="Kepuasan (CSAT)"
          value={summary?.avg_csat != null ? `${summary.avg_csat.toFixed(1)}/5` : "-"}
          hint={`${formatNumber(summary?.csat_responses ?? 0)} penilaian masuk`}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Komplain per Kategori">
          {(data?.categories ?? []).length === 0 ? (
            <Empty>Belum ada komplain pada periode ini.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr className="border-b border-slate-200">
                    <th className="px-3 py-2">Kategori</th>
                    <th className="px-3 py-2">Prioritas</th>
                    <th className="px-3 py-2 text-right">Total</th>
                    <th className="px-3 py-2 text-right">Selesai</th>
                    <th className="px-3 py-2 text-right">Rata-rata</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data?.categories.map((row) => (
                    <tr key={`${row.category}-${row.priority}`}>
                      <td className="px-3 py-2 font-medium text-slate-800">
                        {labelKategori(row.category)}
                      </td>
                      <td className="px-3 py-2 text-slate-600">
                        {PRIORITY_LABELS[row.priority as keyof typeof PRIORITY_LABELS] ?? row.priority}
                      </td>
                      <td className="px-3 py-2 text-right">{formatNumber(row.total)}</td>
                      <td className="px-3 py-2 text-right text-emerald-700">
                        {formatNumber(row.resolved)}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-500">
                        {formatDuration(row.avg_resolution_seconds)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Sebaran Penilaian">
          {(data?.csat_distribution ?? []).length === 0 ? (
            <Empty>Belum ada penilaian dari customer.</Empty>
          ) : (
            <div className="space-y-2 p-3">
              {[5, 4, 3, 2, 1].map((score) => {
                const row = data?.csat_distribution.find((item) => item.score === score);
                const total = row?.total ?? 0;
                const max = Math.max(1, ...(data?.csat_distribution ?? []).map((r) => r.total));
                return (
                  <div key={score} className="flex items-center gap-2 text-xs">
                    <span className="inline-flex w-8 items-center gap-0.5 font-medium text-slate-600">
                      {score} <Star className="size-3 fill-amber-400 text-amber-400" />
                    </span>
                    <div className="h-3 flex-1 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-amber-400"
                        style={{ width: `${(total / max) * 100}%` }}
                      />
                    </div>
                    <span className="w-8 text-right text-slate-500">{total}</span>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>
      </div>

      <Panel title="Volume Harian">
        {(data?.daily ?? []).length === 0 ? (
          <Empty>Belum ada percakapan pada periode ini.</Empty>
        ) : (
          <div className="overflow-x-auto p-3">
            <div className="flex min-w-[480px] items-end gap-1" style={{ height: 120 }}>
              {data?.daily.map((row) => (
                <div key={row.tanggal} className="flex flex-1 flex-col items-center gap-1">
                  <div className="flex w-full flex-1 items-end justify-center">
                    <div
                      className="w-full rounded-t bg-sky-400"
                      style={{ height: `${(row.conversations / maxDaily) * 100}%` }}
                      title={`${row.conversations} percakapan · ${row.complaints} komplain`}
                    />
                  </div>
                  <span className="text-[9px] text-slate-400">
                    {new Date(row.tanggal).getDate()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Panel>

      <Panel title="Per Kanal">
        {(data?.channels ?? []).length === 0 ? (
          <Empty>Belum ada percakapan pada periode ini.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                <tr className="border-b border-slate-200">
                  <th className="px-3 py-2">Kanal</th>
                  <th className="px-3 py-2 text-right">Percakapan</th>
                  <th className="px-3 py-2 text-right">Komplain</th>
                  <th className="px-3 py-2 text-right">Selesai</th>
                  <th className="px-3 py-2 text-right">Respons pertama</th>
                  <th className="px-3 py-2 text-right">CSAT</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data?.channels.map((row) => (
                  <tr key={row.channel}>
                    <td className="px-3 py-2 font-medium capitalize text-slate-800">
                      {row.channel === "whatsapp" ? "WhatsApp" : "Instagram"}
                    </td>
                    <td className="px-3 py-2 text-right">{formatNumber(row.conversations)}</td>
                    <td className="px-3 py-2 text-right text-orange-700">
                      {formatNumber(row.complaints)}
                    </td>
                    <td className="px-3 py-2 text-right text-emerald-700">
                      {formatNumber(row.resolved)}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-500">
                      {formatDuration(row.avg_first_response_seconds)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {row.avg_csat != null ? `${row.avg_csat.toFixed(1)}/5` : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Ulasan Google">
        {!data?.reviews || data.reviews.total === 0 ? (
          <Empty>Belum ada ulasan Google pada periode ini.</Empty>
        ) : (
          <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
            <ReviewStat label="Ulasan masuk" value={formatNumber(data.reviews.total)} />
            <ReviewStat
              label="Rata-rata rating"
              value={data.reviews.avg_rating != null ? `${data.reviews.avg_rating.toFixed(1)}/5` : "-"}
            />
            <ReviewStat
              label="Sudah dibalas"
              value={`${formatNumber(data.reviews.replied)} (${Math.round(
                (data.reviews.replied / data.reviews.total) * 100
              )}%)`}
              tone="text-emerald-700"
            />
            <ReviewStat
              label="Rating ≤ 2 bintang"
              value={formatNumber(data.reviews.low_rating)}
              tone={data.reviews.low_rating > 0 ? "text-red-700" : undefined}
            />
          </div>
        )}
      </Panel>

      <Panel title="Kinerja Agent">
        {(data?.agents ?? []).length === 0 ? (
          <Empty>Belum ada percakapan yang ditangani agent.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                <tr className="border-b border-slate-200">
                  <th className="px-3 py-2">Agent</th>
                  <th className="px-3 py-2 text-right">Ditangani</th>
                  <th className="px-3 py-2 text-right">Selesai</th>
                  <th className="px-3 py-2 text-right">Respons pertama</th>
                  <th className="px-3 py-2 text-right">CSAT</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data?.agents.map((row) => (
                  <tr key={row.agent_name}>
                    <td className="px-3 py-2 font-medium text-slate-800">{row.agent_name}</td>
                    <td className="px-3 py-2 text-right">{formatNumber(row.handled)}</td>
                    <td className="px-3 py-2 text-right text-emerald-700">
                      {formatNumber(row.resolved)}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-500">
                      {formatDuration(row.avg_first_response_seconds)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {row.avg_csat != null ? `${row.avg_csat.toFixed(1)}/5` : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {(summary?.total_sla_breached ?? 0) > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            <strong>{formatNumber(summary?.total_sla_breached ?? 0)} percakapan</strong> melewati
            batas waktu balas pada periode ini. Periksa di Inbox WhatsApp — percakapan
            bertanda &ldquo;Lewat SLA&rdquo;.
          </span>
        </div>
      )}
    </section>
  );
}

function MetricCard({
  icon: Icon,
  tone,
  label,
  value,
  hint,
}: {
  icon: typeof Star;
  tone: string;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className={`mb-2 inline-flex size-9 items-center justify-center rounded-md ${tone}`}>
        <Icon className="size-4" />
      </div>
      <div className="text-xl font-semibold text-slate-950">{value}</div>
      <div className="mt-0.5 text-sm text-slate-600">{label}</div>
      <div className="mt-0.5 text-xs text-slate-400">{hint}</div>
    </div>
  );
}

function ReviewStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50/60 p-3">
      <div className={`text-lg font-semibold ${tone ?? "text-slate-950"}`}>{value}</div>
      <div className="mt-0.5 text-xs text-slate-500">{label}</div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-4 py-2.5">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-8 text-center text-sm text-slate-400">{children}</div>;
}
