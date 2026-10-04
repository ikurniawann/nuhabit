"use client";

import { useMemo } from "react";
import {
  Award,
  BarChart3,
  Coins,
  CreditCard,
  Gift,
  RefreshCw,
  Settings2,
  Sparkles,
  Trophy,
  UserRound,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import type { CrmCustomer } from "../types";
import { useCrmDashboard } from "../queries";
import { formatDateTime, formatNumber, formatRupiah } from "@/lib/format";

function tierLabel(tier: string) {
  return tier ? tier.charAt(0).toUpperCase() + tier.slice(1) : "Regular";
}

// Panel konfigurasi tier & XP pindah permanen ke /dashboard/crm/settings
// (EPIC-011): dashboard ini murni monitoring — konfigurasi hanya Super Admin
// dan panel lama gagal menyimpan tier Regular rank 0 (clamp rank >= 1 vs
// unique constraint rank).
export function CrmDashboardPage() {
  const dashboardQuery = useCrmDashboard();

  const dashboardData = dashboardQuery.data?.data ?? null;
  const schemaReady = dashboardQuery.data?.schemaReady ?? false;
  const dashboardLoading = dashboardQuery.isLoading || dashboardQuery.isFetching;
  const dashboardError = dashboardQuery.error instanceof Error ? dashboardQuery.error.message : null;

  const stats = dashboardData?.stats;
  const statCards = useMemo(
    () => [
      { label: "Customers", value: formatNumber(stats?.totalCustomers ?? 0), icon: UsersRound, tone: "text-sky-700 bg-sky-50" },
      { label: "Member Kartu", value: formatNumber(stats?.cardMembers ?? 0), icon: CreditCard, tone: "text-emerald-700 bg-emerald-50" },
      { label: "Member Terdaftar", value: formatNumber(stats?.registeredMembers ?? 0), icon: UserRound, tone: "text-cyan-700 bg-cyan-50" },
      { label: "Saldo ARK Beredar", value: formatRupiah(stats?.arkOutstanding ?? 0), icon: Coins, tone: "text-amber-700 bg-amber-50" },
      { label: "XP Rules", value: formatNumber(stats?.xpRuleCount ?? 0), icon: Sparkles, tone: "text-violet-700 bg-violet-50" },
      { label: "Tiers", value: formatNumber(stats?.tierCount ?? 0), icon: Trophy, tone: "text-rose-700 bg-rose-50" },
    ],
    [stats]
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
        <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">CRM</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-normal text-slate-950">Membership & Loyalty</h1>
          </div>
          <div className="flex flex-wrap gap-2 sm:items-center">
            <Link
              href="/dashboard/crm/members"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-slate-950 px-3 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800"
            >
              <UsersRound className="size-4" />
              Members
            </Link>
            <Link
              href="/dashboard/crm/reports"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-100"
            >
              <BarChart3 className="size-4" />
              Laporan
            </Link>
            <Link
              href="/dashboard/crm/rewards"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-100"
            >
              <Gift className="size-4" />
              Rewards
            </Link>
            <Link
              href="/dashboard/crm/avatars"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-100"
            >
              <Award className="size-4" />
              Avatars
            </Link>
            <Link
              href="/dashboard/crm/settings"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-100"
            >
              <Settings2 className="size-4" />
              Konfigurasi
            </Link>
            <button
              type="button"
              onClick={() => void dashboardQuery.refetch()}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-100 disabled:opacity-60"
              disabled={dashboardLoading}
            >
              <RefreshCw className={`size-4 ${dashboardLoading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        </div>

        {!schemaReady && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            CRM schema belum aktif di database. Dashboard saat ini membaca data awal dari POS customer.
          </div>
        )}

        {dashboardError && (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {dashboardError}
          </div>
        )}

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {statCards.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.label} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className={`mb-3 flex size-10 items-center justify-center rounded-md ${item.tone}`}>
                  <Icon className="size-5" />
                </div>
                <div className="truncate text-2xl font-semibold text-slate-950" title={item.value}>{item.value}</div>
                <div className="mt-1 text-sm text-slate-500">{item.label}</div>
              </div>
            );
          })}
        </section>

        <section className="grid gap-4 xl:grid-cols-3">
          <LeaderboardTable
            title="Member Paling Loyal"
            valueLabel="XP"
            rows={dashboardData?.topLoyalMembers ?? []}
            getValue={(customer) => formatNumber(customer.total_xp)}
          />
          <LeaderboardTable
            title="Top Spender Transaksi"
            valueLabel="Spend"
            rows={dashboardData?.topTransactionSpenders ?? []}
            getValue={(customer) => formatRupiah(customer.total_spent)}
          />
          <ArkCoinsTable rows={dashboardData?.topArkSpenders ?? []} />
        </section>

        <section className="grid gap-4 lg:grid-cols-[1.4fr_0.9fr]">
          <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h2 className="text-base font-semibold text-slate-950">XP Activity</h2>
              <span className="text-xs text-slate-500">{formatNumber(dashboardData?.recentXpActivity.length ?? 0)} records</span>
            </div>
            <div className="p-4">
              {schemaReady && (dashboardData?.recentXpActivity.length ?? 0) > 0 ? (
                <div className="divide-y divide-slate-100 overflow-hidden rounded-md border border-slate-200">
                  {dashboardData?.recentXpActivity.map((activity) => (
                    <div key={activity.id} className="grid grid-cols-[1fr_auto] gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-slate-900">
                          {activity.description || `${activity.source_channel} ${activity.source_type}`}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {activity.member?.member_code || "Member"} · {formatDateTime(activity.created_at)}
                        </div>
                      </div>
                      <div className={`text-sm font-semibold ${activity.xp_delta >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                        {activity.xp_delta >= 0 ? "+" : ""}
                        {formatNumber(activity.xp_delta)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : schemaReady ? (
                <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                  Belum ada aktivitas XP ledger.
                </div>
              ) : (
                <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                  XP ledger akan muncul setelah migration CRM aktif dan POS checkout terhubung di Phase 2.
                </div>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-base font-semibold text-slate-950">Foundation Status</h2>
            <div className="mt-4 space-y-3">
              <StatusRow label="Membership tiers" value={stats?.tierCount ?? 0} ready={schemaReady} />
              <StatusRow label="XP rule config" value={stats?.xpRuleCount ?? 0} ready={schemaReady} />
              <StatusRow label="Avatar catalog" value={stats?.avatarCount ?? 0} ready={schemaReady} />
              <StatusRow label="Partner event audit" value={stats?.externalEventCount ?? 0} ready={schemaReady} />
            </div>
            <p className="mt-4 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-500">
              Konfigurasi tier, XP rules, bonus topup, Free XP, dan XP produk dikelola Super Admin di halaman{" "}
              <Link href="/dashboard/crm/settings" className="font-medium text-slate-700 underline">
                Konfigurasi
              </Link>
              .
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

function LeaderboardTable({
  title,
  valueLabel,
  rows,
  getValue,
}: {
  title: string;
  valueLabel: string;
  rows: CrmCustomer[];
  getValue: (customer: CrmCustomer) => string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h2 className="text-base font-semibold text-slate-950">{title}</h2>
        <span className="text-xs text-slate-500">{valueLabel}</span>
      </div>
      <div className="divide-y divide-slate-100">
        {rows.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-slate-500">Belum ada data</div>
        ) : (
          rows.map((customer, index) => (
            <div key={customer.id} className="grid grid-cols-[28px_1fr_auto] items-center gap-3 px-4 py-3">
              <div className="flex size-7 items-center justify-center rounded-md bg-slate-100 text-xs font-semibold text-slate-600">
                {index + 1}
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-slate-900">{customer.name || "Customer"}</div>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                  <span>{customer.phone || "-"}</span>
                  <span className="rounded-sm bg-slate-100 px-1.5 py-0.5">{tierLabel(customer.membership_tier)}</span>
                </div>
              </div>
              <div className="text-right text-sm font-semibold text-slate-950">{getValue(customer)}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function ArkCoinsTable({ rows }: { rows: { customer: CrmCustomer | null; ark_coins_used: number }[] }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h2 className="text-base font-semibold text-slate-950">Top Spender ARK Coins</h2>
        <Coins className="size-4 text-amber-600" />
      </div>
      <div className="divide-y divide-slate-100">
        {rows.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-slate-500">Belum ada penggunaan ARK Coins</div>
        ) : (
          rows.map((row, index) => (
            <div key={row.customer?.id ?? index} className="grid grid-cols-[28px_1fr_auto] items-center gap-3 px-4 py-3">
              <div className="flex size-7 items-center justify-center rounded-md bg-slate-100 text-xs font-semibold text-slate-600">
                {index + 1}
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-slate-900">{row.customer?.name || "Customer"}</div>
                <div className="mt-0.5 text-xs text-slate-500">{row.customer?.phone || "-"}</div>
              </div>
              <div className="text-right text-sm font-semibold text-slate-950">{formatNumber(row.ark_coins_used)}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function StatusRow({ label, value, ready }: { label: string; value: number; ready: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2">
      <span className="text-sm text-slate-600">{label}</span>
      <span className={`rounded-sm px-2 py-1 text-xs font-medium ${ready ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
        {ready ? formatNumber(value) : "Pending"}
      </span>
    </div>
  );
}
