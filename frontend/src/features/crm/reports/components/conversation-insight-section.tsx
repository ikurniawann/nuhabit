"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Frown,
  Loader2,
  Meh,
  Percent,
  Smile,
  Sparkles,
  Tags,
} from "lucide-react";
import { analyzePendingConversations, downloadConversationInsightXlsx } from "../api";
import { conversationInsightQueryKey, useConversationInsightReport } from "../queries";
import type { CrmReportPeriodInput } from "../types";
import { formatNumber } from "@/lib/format";

/**
 * EPIC-029 — bagian "Analitik Percakapan" pada halaman Laporan CRM.
 *
 * Hanya angka agregat: kata kunci, topik, sentimen, jumlah komplain. Ringkasan
 * per percakapan (yang bisa memuat PII) sengaja TIDAK ditampilkan di sini — itu
 * hanya ada di inbox, di balik guard agent.
 */

export function ConversationInsightSection({ period }: { period: CrmReportPeriodInput }) {
  const queryClient = useQueryClient();
  const reportQuery = useConversationInsightReport(period);
  const data = reportQuery.data ?? null;
  const loading = reportQuery.isLoading || reportQuery.isFetching;
  const loadError = reportQuery.error instanceof Error ? reportQuery.error.message : null;

  const [analyzing, setAnalyzing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const summary = data?.summary;
  const analyzed = summary?.analyzed ?? 0;
  const totalConversations = summary?.total_conversations ?? 0;
  const coverage =
    totalConversations > 0 ? Math.round((analyzed / totalConversations) * 100) : 0;
  const maxKeyword = Math.max(1, ...(data?.keywords ?? []).map((row) => row.conversations));
  const maxTopic = Math.max(1, ...(data?.topics ?? []).map((row) => row.count));

  async function jalankanAnalisa() {
    setAnalyzing(true);
    setNotice(null);
    setActionError(null);
    try {
      const batch = await analyzePendingConversations();
      const { requested, analyzed: baru, cached, empty, failed } = batch.summary;
      if (requested === 0) {
        setNotice("Tidak ada percakapan baru yang perlu dianalisa.");
      } else {
        setNotice(
          `${formatNumber(requested)} percakapan diperiksa: ${formatNumber(baru)} dianalisa, ` +
            `${formatNumber(cached)} sudah terkini, ${formatNumber(empty)} tanpa isi teks, ` +
            `${formatNumber(failed)} gagal.`
        );
      }
      // Muat ulang laporan agar angka hasil analisa langsung terlihat.
      await queryClient.invalidateQueries({ queryKey: conversationInsightQueryKey(period) });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Gagal menganalisa percakapan");
    } finally {
      setAnalyzing(false);
    }
  }

  async function unduhExcel() {
    setExporting(true);
    setActionError(null);
    try {
      await downloadConversationInsightXlsx(period);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Gagal mengunduh laporan");
    } finally {
      setExporting(false);
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2">
        <div className="flex items-center gap-2">
          <Sparkles className="size-5 text-violet-600" />
          <h2 className="text-lg font-semibold text-slate-950">Analitik Percakapan</h2>
          {loading && <Loader2 className="size-4 animate-spin text-slate-400" />}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void jalankanAnalisa()}
            disabled={analyzing}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-violet-600 px-3 text-sm font-medium text-white transition hover:bg-violet-700 disabled:opacity-50"
          >
            {analyzing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            {analyzing ? "Menganalisa..." : "Analisa percakapan baru"}
          </button>
          <button
            type="button"
            onClick={() => void unduhExcel()}
            disabled={exporting}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
          >
            {exporting ? <Loader2 className="size-4 animate-spin" /> : null}
            Export Excel
          </button>
        </div>
      </div>

      <p className="text-xs text-slate-500">
        Ringkasan dibuat AI dari isi percakapan. Percakapan yang isinya tidak berubah tidak
        dianalisa ulang. Bagian ini hanya menampilkan angka agregat — isi chat, nomor, dan nama
        customer tidak ikut ditampilkan maupun ter-export.
      </p>

      {(loadError || actionError) && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {loadError || actionError}
        </div>
      )}
      {notice && (
        <div className="rounded-md border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-800">
          {notice}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={Percent}
          tone="text-sky-700 bg-sky-50"
          label="Percakapan teranalisa"
          value={`${formatNumber(analyzed)} / ${formatNumber(totalConversations)}`}
          hint={`${coverage}% cakupan · ${formatNumber(summary?.not_analyzed ?? 0)} belum dianalisa`}
        />
        <MetricCard
          icon={AlertTriangle}
          tone="text-amber-700 bg-amber-50"
          label="Terindikasi komplain"
          value={formatNumber(summary?.complaints ?? 0)}
          hint="Menurut penilaian AI atas isi percakapan"
        />
        <MetricCard
          icon={Frown}
          tone="text-rose-700 bg-rose-50"
          label="Sentimen negatif"
          value={formatNumber(summary?.sentiment.negatif ?? 0)}
          hint={`${formatNumber(summary?.sentiment.netral ?? 0)} netral`}
        />
        <MetricCard
          icon={Smile}
          tone="text-emerald-700 bg-emerald-50"
          label="Sentimen positif"
          value={formatNumber(summary?.sentiment.positif ?? 0)}
          hint="Pelanggan puas di akhir percakapan"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white">
          <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
            <Tags className="size-4 text-slate-500" />
            <h3 className="text-sm font-semibold text-slate-900">Top Kata Kunci</h3>
          </div>
          {!data?.keywords.length ? (
            <div className="px-4 py-8 text-center text-sm text-slate-500">
              {loading ? "Memuat..." : "Belum ada kata kunci pada periode ini."}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                  <th className="px-4 py-2 font-medium">Kata kunci</th>
                  <th className="px-4 py-2 text-right font-medium">Percakapan</th>
                  <th className="px-4 py-2 text-right font-medium">Kemunculan</th>
                </tr>
              </thead>
              <tbody>
                {data.keywords.map((row) => (
                  <tr key={row.keyword} className="border-b border-slate-50 last:border-0">
                    <td className="px-4 py-2">
                      <div className="font-medium text-slate-800">{row.keyword}</div>
                      <div className="mt-1 h-1 w-full rounded-full bg-slate-100">
                        <div
                          className="h-1 rounded-full bg-violet-500"
                          style={{ width: `${(row.conversations / maxKeyword) * 100}%` }}
                        />
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right font-semibold text-slate-950">
                      {formatNumber(row.conversations)}
                    </td>
                    <td className="px-4 py-2 text-right text-slate-500">
                      {formatNumber(row.count)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="rounded-lg border border-slate-200 bg-white">
          <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
            <Meh className="size-4 text-slate-500" />
            <h3 className="text-sm font-semibold text-slate-900">Topik Percakapan</h3>
          </div>
          {!data?.topics.length ? (
            <div className="px-4 py-8 text-center text-sm text-slate-500">
              {loading ? "Memuat..." : "Belum ada topik pada periode ini."}
            </div>
          ) : (
            <div className="divide-y divide-slate-50">
              {data.topics.map((row) => (
                <div key={row.topic} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-slate-800">{row.topic}</div>
                    <div className="mt-1 h-1 w-full rounded-full bg-slate-100">
                      <div
                        className="h-1 rounded-full bg-sky-500"
                        style={{ width: `${(row.count / maxTopic) * 100}%` }}
                      />
                    </div>
                  </div>
                  <div className="text-sm font-semibold text-slate-950">
                    {formatNumber(row.count)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
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
  icon: typeof Sparkles;
  tone: string;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-2">
        <span className={`grid size-8 place-items-center rounded-md ${tone}`}>
          <Icon className="size-4" />
        </span>
        <span className="text-xs font-medium text-slate-500">{label}</span>
      </div>
      <div className="mt-2 text-xl font-semibold text-slate-950">{value}</div>
      <div className="mt-0.5 text-xs text-slate-500">{hint}</div>
    </div>
  );
}
