"use client";

import { useMemo, useState } from "react";
import {
  ArrowLeftRight,
  CalendarRange,
  Coins,
  CreditCard,
  RefreshCw,
  TrendingUp,
  UsersRound,
  Wallet,
} from "lucide-react";
import { useCrmReports } from "../queries";
import { CsReportSection } from "./cs-report-section";
import { ConversationInsightSection } from "./conversation-insight-section";
import type { CrmReportPeriodInput } from "../types";
import { formatDate, formatNumber, formatRupiah } from "@/lib/format";

function tierLabel(tier: string) {
  return tier ? tier.charAt(0).toUpperCase() + tier.slice(1) : "Regular";
}

function memberTypeLabel(type: string) {
  return type === "card" ? "Kartu" : "Terdaftar";
}

function toDateInputValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

function currentMonthPeriod(): CrmReportPeriodInput {
  const now = new Date();
  return {
    from: toDateInputValue(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))),
    to: toDateInputValue(now),
  };
}

function lastDaysPeriod(days: number): CrmReportPeriodInput {
  const now = new Date();
  const from = new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  return { from: toDateInputValue(from), to: toDateInputValue(now) };
}

export function CrmReportsPage() {
  const [draft, setDraft] = useState<CrmReportPeriodInput>(() => currentMonthPeriod());
  const [applied, setApplied] = useState<CrmReportPeriodInput>(draft);

  const reportsQuery = useCrmReports(applied);
  const data = reportsQuery.data ?? null;
  const loading = reportsQuery.isLoading || reportsQuery.isFetching;
  const error = reportsQuery.error instanceof Error ? reportsQuery.error.message : null;

  const totals = data?.reconciliation.totals;
  const summaryCards = useMemo(
    () => [
      {
        label: "Saldo ARK Beredar",
        value: formatRupiah(data?.reconciliation.outstanding_balance ?? 0),
        hint: "Liabilitas platform saat ini",
        icon: Wallet,
        tone: "text-amber-700 bg-amber-50",
      },
      {
        label: "Topup Periode",
        value: formatRupiah(totals?.topup_amount ?? 0),
        hint: "Kas masuk dari topup",
        icon: Coins,
        tone: "text-emerald-700 bg-emerald-50",
      },
      {
        label: "Bonus Topup",
        value: formatRupiah(totals?.bonus_amount ?? 0),
        hint: "Saldo bonus (non-tunai)",
        icon: TrendingUp,
        tone: "text-violet-700 bg-violet-50",
      },
      {
        label: "Topup FOC",
        value: formatRupiah(totals?.foc_topup_amount ?? 0),
        hint: "Gratis untuk marketing — bukan kas masuk",
        icon: Coins,
        tone: "text-amber-700 bg-amber-50",
      },
      {
        label: "Belanja ARK Periode",
        value: formatRupiah(totals?.spend_amount ?? 0),
        hint: "ARK dibelanjakan di kasir",
        icon: ArrowLeftRight,
        tone: "text-sky-700 bg-sky-50",
      },
      {
        label: "Member Kartu",
        value: formatNumber(data?.members.card ?? 0),
        hint: "NFC tertaut + akses topup",
        icon: CreditCard,
        tone: "text-rose-700 bg-rose-50",
      },
      {
        label: "Member Terdaftar",
        value: formatNumber(data?.members.registered ?? 0),
        hint: "Tanpa kartu, tanpa topup",
        icon: UsersRound,
        tone: "text-slate-700 bg-slate-100",
      },
    ],
    [data, totals]
  );

  function applyPreset(period: CrmReportPeriodInput) {
    setDraft(period);
    setApplied(period);
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
        <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">CRM</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-normal text-slate-950">Laporan &amp; Rekonsiliasi</h1>
            <p className="mt-1 text-sm text-slate-500">
              Top spender basis order, frequent visitor, dan rekonsiliasi ARK Coin antar-venue.
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-1.5">
              <CalendarRange className="size-4 shrink-0 text-slate-500" />
              <input
                type="date"
                value={draft.from}
                max={draft.to}
                onChange={(event) => setDraft((current) => ({ ...current, from: event.target.value }))}
                className="h-8 bg-transparent text-sm text-slate-900 outline-none"
                aria-label="Dari tanggal"
              />
              <span className="text-sm text-slate-400">s/d</span>
              <input
                type="date"
                value={draft.to}
                min={draft.from}
                onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value }))}
                className="h-8 bg-transparent text-sm text-slate-900 outline-none"
                aria-label="Sampai tanggal"
              />
            </div>
            <button
              type="button"
              onClick={() => setApplied(draft)}
              disabled={loading || !draft.from || !draft.to}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-slate-950 px-3 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-60"
            >
              Terapkan
            </button>
            <button
              type="button"
              onClick={() => applyPreset(currentMonthPeriod())}
              className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-100"
            >
              Bulan ini
            </button>
            <button
              type="button"
              onClick={() => applyPreset(lastDaysPeriod(30))}
              className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-100"
            >
              30 hari
            </button>
            <button
              type="button"
              onClick={() => void reportsQuery.refetch()}
              disabled={loading}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-100 disabled:opacity-60"
            >
              <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        {data && (
          <p className="text-sm text-slate-500">
            Periode laporan: <span className="font-medium text-slate-900">{formatDate(data.period.from)}</span> s/d{" "}
            <span className="font-medium text-slate-900">{formatDate(data.period.to)}</span>
          </p>
        )}

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {summaryCards.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.label} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className={`mb-3 flex size-10 items-center justify-center rounded-md ${item.tone}`}>
                  <Icon className="size-5" />
                </div>
                <div className="truncate text-lg font-semibold text-slate-950" title={item.value}>
                  {item.value}
                </div>
                <div className="mt-1 text-sm text-slate-600">{item.label}</div>
                <div className="mt-0.5 text-xs text-slate-400">{item.hint}</div>
              </div>
            );
          })}
        </section>

        <ReconciliationSection
          loading={loading}
          venues={data?.reconciliation.venues ?? []}
          totals={totals ?? { topup_amount: 0, bonus_amount: 0, foc_topup_amount: 0, spend_amount: 0, net_flow: 0 }}
          untaggedAmount={data?.reconciliation.untagged_topup_amount ?? 0}
          untaggedCount={data?.reconciliation.untagged_topup_count ?? 0}
        />

        <section className="grid gap-4 xl:grid-cols-2">
          <TopSpenderTable loading={loading} rows={data?.topSpenders ?? []} />
          <FrequentVisitorTable loading={loading} rows={data?.frequentVisitors ?? []} />
        </section>

        <CsReportSection period={applied} />

        <ConversationInsightSection period={applied} />
      </div>
    </div>
  );
}

function ReconciliationSection({
  loading,
  venues,
  totals,
  untaggedAmount = 0,
  untaggedCount = 0,
}: {
  loading: boolean;
  venues: NonNullable<ReturnType<typeof useCrmReports>["data"]>["reconciliation"]["venues"];
  totals: { topup_amount: number; bonus_amount: number; foc_topup_amount: number; spend_amount: number; net_flow: number };
  untaggedAmount?: number;
  untaggedCount?: number;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-4 py-3">
        <h2 className="text-base font-semibold text-slate-950">Rekonsiliasi ARK Coin Antar-Venue</h2>
        <p className="mt-1 text-sm text-slate-500">
          Net positif = venue menerima kas topup lebih besar dari ARK yang dibelanjakan di venue itu (masih memegang
          liabilitas); net negatif = venue menanggung belanja ARK yang topup-nya terjadi di venue lain.
        </p>
      </div>

      {loading && venues.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-slate-500">Memuat rekonsiliasi...</div>
      ) : venues.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-slate-500">
          Belum ada transaksi wallet pada periode ini.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3 font-medium">Venue</th>
                <th className="px-4 py-3 text-right font-medium">Topup</th>
                <th className="px-4 py-3 text-right font-medium">Bonus</th>
                <th className="px-4 py-3 text-right font-medium">Topup FOC</th>
                <th className="px-4 py-3 text-right font-medium">Belanja ARK</th>
                <th className="px-4 py-3 text-right font-medium">Net</th>
                <th className="px-4 py-3 text-right font-medium">#Topup</th>
                <th className="px-4 py-3 text-right font-medium">#Bayar</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {venues.map((venue, index) => (
                <tr key={`${venue.company_id ?? "none"}-${venue.branch_id ?? index}`}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{venue.branch_name}</div>
                    <div className="text-xs text-slate-500">{venue.company_name}</div>
                  </td>
                  <td className="px-4 py-3 text-right text-slate-900">{formatRupiah(venue.topup_amount)}</td>
                  <td className="px-4 py-3 text-right text-slate-600">{formatRupiah(venue.bonus_amount)}</td>
                  <td className="px-4 py-3 text-right text-amber-700">{formatRupiah(venue.foc_topup_amount ?? 0)}</td>
                  <td className="px-4 py-3 text-right text-slate-900">{formatRupiah(venue.spend_amount)}</td>
                  <td
                    className={`px-4 py-3 text-right font-semibold ${
                      venue.net_flow >= 0 ? "text-emerald-700" : "text-red-700"
                    }`}
                  >
                    {formatRupiah(venue.net_flow)}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-600">{formatNumber(venue.topup_count)}</td>
                  <td className="px-4 py-3 text-right text-slate-600">{formatNumber(venue.payment_count)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-200 bg-slate-50 font-semibold text-slate-950">
                <td className="px-4 py-3">Total</td>
                <td className="px-4 py-3 text-right">{formatRupiah(totals.topup_amount)}</td>
                <td className="px-4 py-3 text-right">{formatRupiah(totals.bonus_amount)}</td>
                <td className="px-4 py-3 text-right text-amber-700">{formatRupiah(totals.foc_topup_amount)}</td>
                <td className="px-4 py-3 text-right">{formatRupiah(totals.spend_amount)}</td>
                <td
                  className={`px-4 py-3 text-right ${totals.net_flow >= 0 ? "text-emerald-700" : "text-red-700"}`}
                >
                  {formatRupiah(totals.net_flow)}
                </td>
                <td className="px-4 py-3" colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {untaggedCount > 0 ? (
        <p className="border-t border-slate-200 px-4 py-2.5 text-xs text-slate-500">
          Di luar tabel: {formatRupiah(untaggedAmount)} dari {formatNumber(untaggedCount)} topup belum
          bertanda venue, sehingga tidak bisa direkonsiliasi antar-venue.
        </p>
      ) : null}
    </section>
  );
}

function TopSpenderTable({
  loading,
  rows,
}: {
  loading: boolean;
  rows: NonNullable<ReturnType<typeof useCrmReports>["data"]>["topSpenders"];
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h2 className="text-base font-semibold text-slate-950">Top Spender (Basis Order)</h2>
        <span className="text-xs text-slate-500">Semua metode bayar · topup tidak dihitung</span>
      </div>
      <div className="divide-y divide-slate-100">
        {loading && rows.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-slate-500">Memuat...</div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-slate-500">Belum ada order berbayar pada periode ini.</div>
        ) : (
          rows.map((row, index) => (
            <div key={row.id} className="grid grid-cols-[28px_1fr_auto] items-center gap-3 px-4 py-3">
              <div className="flex size-7 items-center justify-center rounded-md bg-slate-100 text-xs font-semibold text-slate-600">
                {index + 1}
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-slate-900">{row.name}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span>{row.phone || "-"}</span>
                  <span className="rounded-sm bg-slate-100 px-1.5 py-0.5">{tierLabel(row.membership_tier)}</span>
                  <span className="rounded-sm bg-slate-100 px-1.5 py-0.5">{memberTypeLabel(row.member_type)}</span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm font-semibold text-slate-950">{formatRupiah(row.total_spend)}</div>
                <div className="mt-0.5 text-xs text-slate-500">
                  {formatNumber(row.order_count)} order
                  {row.ark_spend > 0 ? ` · ARK ${formatRupiah(row.ark_spend)}` : ""}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function FrequentVisitorTable({
  loading,
  rows,
}: {
  loading: boolean;
  rows: NonNullable<ReturnType<typeof useCrmReports>["data"]>["frequentVisitors"];
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h2 className="text-base font-semibold text-slate-950">Frequent Visitor</h2>
        <span className="text-xs text-slate-500">Hari kunjungan pada periode</span>
      </div>
      <div className="divide-y divide-slate-100">
        {loading && rows.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-slate-500">Memuat...</div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-slate-500">Belum ada kunjungan pada periode ini.</div>
        ) : (
          rows.map((row, index) => (
            <div key={row.id} className="grid grid-cols-[28px_1fr_auto] items-center gap-3 px-4 py-3">
              <div className="flex size-7 items-center justify-center rounded-md bg-slate-100 text-xs font-semibold text-slate-600">
                {index + 1}
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-slate-900">{row.name}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span>{row.phone || "-"}</span>
                  <span className="rounded-sm bg-slate-100 px-1.5 py-0.5">{tierLabel(row.membership_tier)}</span>
                  <span>Terakhir: {formatDate(row.last_visit_at)}</span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm font-semibold text-slate-950">{formatNumber(row.visit_days)} hari</div>
                <div className="mt-0.5 text-xs text-slate-500">
                  {formatNumber(row.order_count)} order · lifetime {formatNumber(row.lifetime_visits)} visit
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
