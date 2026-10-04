"use client";

import { useState } from "react";
import {
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  Clock,
  Coins,
  Loader2,
  ShoppingCart,
  Sparkles,
  TrendingUp,
  Users,
  WalletCards,
} from "lucide-react";
import { FadeIn, PageTransition } from "@/components/motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { HelpHint } from "@/components/ui/help-hint";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { PurchasingPageHeader } from "@/features/purchasing/components/shared/purchasing-page-header";
import { usePosDashboard } from "../queries";
import type { DashboardPeriod } from "../types";
import {
  formatArk,
  PosArkPaymentShareChart,
  PosArkXpTrendChart,
  PosRevenueTrendChart,
  PosTopProductsChart,
} from "./pos-dashboard-charts";
import { formatNumber, formatRupiah } from "@/lib/format";

const PERIOD_OPTIONS: Array<{ value: DashboardPeriod; label: string }> = [
  { value: "today", label: "Today" },
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
];

function formatChange(value: number) {
  const abs = Math.round(Math.abs(value || 0) * 10) / 10;
  return `${value >= 0 ? "+" : "-"}${abs}%`;
}

function orderStatusLabel(status: string, paymentStatus?: string) {
  if (status === "completed") return { label: "Completed", className: "bg-green-50 text-green-700" };
  if (status === "voided") return { label: "Voided", className: "bg-red-50 text-red-700" };
  if (paymentStatus === "paid") return { label: "Paid", className: "bg-blue-50 text-blue-700" };
  if (paymentStatus === "partial") return { label: "Partial", className: "bg-purple-50 text-purple-700" };
  return { label: "Pending", className: "bg-yellow-50 text-yellow-700" };
}

function MetricCard({
  title,
  value,
  helper,
  icon: Icon,
  change,
  helpId,
}: {
  title: string;
  value: string;
  helper: string;
  icon: typeof WalletCards;
  change?: number;
  helpId?: string;
}) {
  return (
    <Card className="border-gray-200/70 shadow-xs">
      <CardContent className="p-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="rounded-lg bg-primary/10 p-2 text-brand-text">
            <Icon className="h-5 w-5" />
          </div>
          {change !== undefined && (
            <div
              className={`flex items-center text-xs font-semibold ${
                change >= 0 ? "text-brand-text" : "text-red-600"
              }`}
            >
              {change >= 0 ? (
                <ArrowUpRight className="mr-1 h-3.5 w-3.5" />
              ) : (
                <ArrowDownRight className="mr-1 h-3.5 w-3.5" />
              )}
              {formatChange(change)}
            </div>
          )}
        </div>
        <div className="text-2xl font-bold text-gray-900">{value}</div>
        <div className="mt-1 flex items-center gap-1 text-sm font-medium text-gray-500">
          {title}
          {helpId && <HelpHint helpId={helpId} role="default" />}
        </div>
        <div className="mt-2 text-xs text-gray-400">{helper}</div>
      </CardContent>
    </Card>
  );
}

export function PosDashboardPage() {
  const [selectedPeriod, setSelectedPeriod] = useState<DashboardPeriod>("today");
  /* Rentang custom (owner 2026-08-23): Start/End Date di sebelah tombol
   * periode. draft = isian input; activeRange = yang benar-benar di-query
   * (baru terkirim setelah kedua tanggal terisi & valid). */
  const [draftRange, setDraftRange] = useState<{ from: string; to: string }>({
    from: "",
    to: "",
  });
  const [activeRange, setActiveRange] = useState<{ from: string; to: string } | null>(null);
  const { data, isLoading, isFetching, error } = usePosDashboard(selectedPeriod, activeRange);

  const applyRange = (next: { from: string; to: string }) => {
    setDraftRange(next);
    if (next.from && next.to && next.from <= next.to) {
      setActiveRange({ ...next });
    }
  };
  const pickPeriod = (period: DashboardPeriod) => {
    setSelectedPeriod(period);
    setActiveRange(null);
    setDraftRange({ from: "", to: "" });
  };

  const loading = isLoading || isFetching;
  const errorMessage = error instanceof Error ? error.message : "";
  const stats = data?.stats ?? null;
  const arkXp = data?.arkXp ?? null;
  const trend = data?.trend ?? [];
  const topProducts = data?.topProducts ?? [];
  const topLoyalMembers = data?.topLoyalMembers ?? [];
  const recentOrders = data?.recentOrders ?? [];

  const periodLabel = activeRange
    ? `${activeRange.from} – ${activeRange.to}`
    : selectedPeriod === "today" ? "today" : selectedPeriod === "week" ? "this week" : "this month";

  return (
    <TooltipProvider>
    <PageTransition className="space-y-6">
      <PurchasingPageHeader
        title="POS Dashboard"
        description="Sales overview, loyalty activity, and recent orders"
        actions={
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            {PERIOD_OPTIONS.map((option) => (
              <Button
                key={option.value}
                type="button"
                variant="outline"
                onClick={() => pickPeriod(option.value)}
                className={
                  selectedPeriod === option.value && !activeRange
                    ? "h-9 rounded-lg border-primary bg-primary px-3 text-sm font-semibold text-primary-foreground shadow-sm hover:border-primary/90 hover:bg-primary/90"
                    : "purchasing-secondary-button h-9 px-3 text-sm"
                }
              >
                {option.label}
              </Button>
            ))}
            {/* Rentang custom (owner 2026-08-23) — aktif begitu kedua tanggal terisi */}
            <div
              className={`flex items-center gap-1 rounded-lg border px-2 py-1 ${
                activeRange ? "border-primary bg-primary/5" : "border-gray-200/80"
              }`}
            >
              <input
                type="date"
                aria-label="Start date"
                value={draftRange.from}
                max={draftRange.to || undefined}
                onChange={(e) => applyRange({ ...draftRange, from: e.target.value })}
                className="h-7 bg-transparent text-sm text-gray-700 outline-none"
              />
              <span className="text-xs text-gray-400">–</span>
              <input
                type="date"
                aria-label="End date"
                value={draftRange.to}
                min={draftRange.from || undefined}
                onChange={(e) => applyRange({ ...draftRange, to: e.target.value })}
                className="h-7 bg-transparent text-sm text-gray-700 outline-none"
              />
            </div>
          </div>
        }
      />

      {errorMessage && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200/80 bg-red-50 p-4 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {errorMessage}
        </div>
      )}

      {loading && !stats ? (
        <div className="flex items-center justify-center gap-2 py-20 text-gray-500">
          <Loader2 className="h-5 w-5 animate-spin text-brand-text" />
          <span className="text-sm">Loading dashboard...</span>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <FadeIn delay={0}>
              <MetricCard
                title="Revenue"
                value={formatRupiah(stats?.todayRevenue || 0)}
                helper={`Total revenue ${periodLabel}`}
                icon={WalletCards}
                change={stats?.revenueChange}
              />
            </FadeIn>
            <FadeIn delay={0.05}>
              <MetricCard
                title="Orders"
                value={String(stats?.todayOrders || 0)}
                helper={`Completed orders ${periodLabel}`}
                icon={ShoppingCart}
                change={stats?.ordersChange}
              />
            </FadeIn>
            <FadeIn delay={0.10}>
              <MetricCard
                title="Average Order Value"
                value={formatRupiah(stats?.averageOrderValue || 0)}
                helper="Revenue per completed order"
                icon={TrendingUp}
                helpId="pos.dashboard.aov"
              />
            </FadeIn>
            <FadeIn delay={0.15}>
              <MetricCard
                title="Active Cashiers"
                value={String(stats?.activeCashiers || 0)}
                helper={`Cashiers with orders ${periodLabel}`}
                icon={Users}
                helpId="pos.dashboard.active-cashiers"
              />
            </FadeIn>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <FadeIn delay={0.20}>
              <MetricCard
                title="ARK Used"
                value={formatArk(arkXp?.totalArkUsed || 0)}
                helper={`${arkXp?.arkPaymentOrders || 0} orders paid with ARK`}
                icon={Coins}
              />
            </FadeIn>
            <FadeIn delay={0.25}>
              <MetricCard
                title="ARK Masuk"
                value={formatArk(arkXp?.totalArkEarned || 0)}
                helper="Top-up & bonus koin member periode ini"
                icon={Sparkles}
              />
            </FadeIn>
            <FadeIn delay={0.25}>
              <MetricCard
                title="XP Earned"
                value={`${formatNumber(arkXp?.totalXpEarned || 0)} XP`}
                helper="Experience points issued in period"
                icon={Sparkles}
              />
            </FadeIn>
            <FadeIn delay={0.25}>
              <MetricCard
                title="Member ARK Balance"
                value={formatArk(arkXp?.totalArkBalance || 0)}
                helper={`${arkXp?.membersWithXp || 0} members with XP`}
                icon={Users}
              />
            </FadeIn>
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
            <div className="xl:col-span-8">
              <PosRevenueTrendChart points={trend} />
            </div>
            <div className="xl:col-span-4">
              <PosArkPaymentShareChart
                arkOrders={arkXp?.arkPaymentOrders || 0}
                otherOrders={Math.max((stats?.todayOrders || 0) - (arkXp?.arkPaymentOrders || 0), 0)}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <PosArkXpTrendChart points={trend} />
            <PosTopProductsChart products={topProducts} />
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <PurchasingListSection
              icon={Sparkles}
              title="Top Loyal Members"
              description="Members ranked by total XP and ARK balance"
            >
              <div className="divide-y divide-gray-100">
                {topLoyalMembers.length > 0 ? (
                  topLoyalMembers.map((member, index) => (
                    <div
                      key={member.id}
                      className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-gray-50"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-brand-text">
                          {index + 1}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-medium text-gray-900">{member.name}</p>
                          <p className="text-xs capitalize text-gray-500">{member.membershipTier}</p>
                        </div>
                      </div>
                      <div className="text-right text-sm">
                        <p className="font-semibold text-indigo-600">
                          {formatNumber(member.totalXp)} XP
                        </p>
                        <p className="text-xs font-medium text-amber-600">{formatArk(member.arkBalance)}</p>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="px-5 py-10 text-center text-sm text-gray-400">
                    No member loyalty data yet
                  </div>
                )}
              </div>
            </PurchasingListSection>

            <PurchasingListSection
              icon={ShoppingCart}
              title="Top Products"
              description="Best-selling products in the selected period"
            >
              <div className="divide-y divide-gray-100">
                {topProducts.length > 0 ? (
                  topProducts.map((product, index) => (
                    <div
                      key={product.id}
                      className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-gray-50"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-brand-text">
                          {index + 1}
                        </div>
                        <p className="truncate font-medium text-gray-900">{product.name}</p>
                      </div>
                      <div className="text-right text-sm">
                        <p className="font-semibold text-gray-900">{product.sold} sold</p>
                        <p className="text-xs text-gray-500">{formatRupiah(product.revenue)}</p>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="px-5 py-10 text-center text-sm text-gray-400">
                    No product sales for this period
                  </div>
                )}
              </div>
            </PurchasingListSection>
          </div>

          <PurchasingListSection
            icon={Clock}
            title="Recent Orders"
            description="Latest POS orders across all cashiers"
          >
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold">Order</th>
                    <th className="px-4 py-3 text-left font-semibold">Cashier</th>
                    <th className="px-4 py-3 text-right font-semibold">Total</th>
                    <th className="px-4 py-3 text-left font-semibold">Status</th>
                    <th className="px-4 py-3 text-right font-semibold">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {recentOrders.length > 0 ? (
                    recentOrders.map((order) => {
                      const statusInfo = orderStatusLabel(order.status, order.payment_status);
                      return (
                        <tr key={order.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 font-medium text-gray-900">{order.id}</td>
                          <td className="px-4 py-3 text-gray-700">{order.cashier}</td>
                          <td className="px-4 py-3 text-right font-semibold text-gray-900">
                            {formatRupiah(order.total)}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${statusInfo.className}`}
                            >
                              {statusInfo.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right text-gray-500">{order.time}</td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={5} className="px-4 py-10 text-center text-gray-400">
                        No recent orders
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </PurchasingListSection>
        </>
      )}
    </PageTransition>
    </TooltipProvider>
  );
}
