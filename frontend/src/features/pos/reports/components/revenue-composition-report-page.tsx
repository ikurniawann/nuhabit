"use client";

import { useMemo, useState } from "react";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  CupSoda,
  Loader2,
  Percent,
  UtensilsCrossed,
  WalletCards,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FadeIn, PageTransition } from "@/components/motion";
import { TooltipProvider } from "@/components/ui/tooltip";
import { firstDayOfMonthWib, todayWib } from "@/lib/pos/report-dates";
import { PurchasingPageHeader } from "@/features/purchasing/components/shared/purchasing-page-header";
import type { RevenueCompositionBucket, RevenueCompositionGroup } from "@/lib/pos/reports/types";
import { useRevenueCompositionReport } from "../queries";
import { formatNumber, formatRupiah } from "@/lib/format";

const formatPct = (value: number) => `${formatNumber(value, 1)}%`;

/** Dua cara membaca komposisi: nilai rupiah, atau jumlah porsi terjual. */
type Measure = "amount" | "qty";

const GROUP_ICON = {
  food: UtensilsCrossed,
  beverage: CupSoda,
} as const;

function MetricCard({
  title,
  value,
  helper,
  icon: Icon,
}: {
  title: string;
  value: string;
  helper: string;
  icon: typeof WalletCards;
}) {
  return (
    <Card className="border-gray-200/70 shadow-xs">
      <CardContent className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="rounded-lg bg-primary/10 p-2 text-brand-text">
            <Icon className="h-5 w-5" />
          </div>
        </div>
        <div className="text-2xl font-bold text-gray-900">{value}</div>
        <div className="mt-1 text-sm font-medium text-gray-500">{title}</div>
        <div className="mt-2 text-xs text-gray-400">{helper}</div>
      </CardContent>
    </Card>
  );
}

/** Bilah proporsi Food vs Beverage — dibaca sekilas tanpa perlu menghitung. */
function ShareBar({ food, beverage }: { food: number; beverage: number }) {
  const total = food + beverage;
  const foodPct = total > 0 ? (food / total) * 100 : 0;
  const bevPct = total > 0 ? (beverage / total) * 100 : 0;

  return (
    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-gray-100">
      <div className="bg-amber-500" style={{ width: `${foodPct}%` }} aria-hidden />
      <div className="bg-sky-500" style={{ width: `${bevPct}%` }} aria-hidden />
    </div>
  );
}

function GroupSection({
  group,
  measure,
  expanded,
  onToggle,
}: {
  group: RevenueCompositionGroup;
  measure: Measure;
  expanded: boolean;
  onToggle: () => void;
}) {
  const Icon = GROUP_ICON[group.id as keyof typeof GROUP_ICON] || UtensilsCrossed;
  const isAmount = measure === "amount";

  const primary = isAmount ? formatRupiah(group.sales) : `${formatNumber(group.quantity)} porsi`;
  const share = isAmount ? group.sales_share_pct : group.qty_share_pct;

  return (
    <Card className="border-gray-200/70 shadow-xs">
      <CardContent className="p-0">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-gray-50 focus-visible:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset--2 focus-visible:outline-primary"
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
          )}
          <div
            className={`rounded-lg p-2 ${
              group.id === "beverage" ? "bg-sky-500/10 text-sky-600" : "bg-amber-500/10 text-amber-600"
            }`}
          >
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-gray-900">{group.label}</div>
            <div className="text-xs text-gray-500">
              {group.categories.length} kategori &middot; {formatPct(share)} dari total
            </div>
          </div>
          <div className="hidden text-right sm:block">
            <div className="text-xs text-gray-500">Sales</div>
            <div className="text-sm font-semibold tabular-nums text-gray-900">{primary}</div>
          </div>
          <div className="hidden w-28 text-right md:block">
            <div className="text-xs text-gray-500">Cost</div>
            <div className="text-sm tabular-nums text-gray-700">
              {isAmount ? formatRupiah(group.cost) : "—"}
            </div>
          </div>
          <div className="w-20 text-right">
            <div className="text-xs text-gray-500">Cost %</div>
            <div className="text-sm font-semibold tabular-nums text-gray-900">
              {formatPct(group.cost_pct)}
            </div>
          </div>
        </button>

        {expanded && (
          <div className="overflow-x-auto border-t border-gray-200/70">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="bg-gray-50/80 text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-2.5 text-left font-medium">Kategori</th>
                  <th className="px-4 py-2.5 text-right font-medium">Qty</th>
                  <th className="px-4 py-2.5 text-right font-medium">Sales</th>
                  <th className="px-4 py-2.5 text-right font-medium">Cost</th>
                  <th className="px-4 py-2.5 text-right font-medium">Margin</th>
                  <th className="px-4 py-2.5 text-right font-medium">Cost %</th>
                  <th className="px-4 py-2.5 text-right font-medium">Porsi grup</th>
                </tr>
              </thead>
              <tbody>
                {group.categories.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-sm text-gray-500">
                      Tidak ada penjualan pada rentang tanggal ini.
                    </td>
                  </tr>
                ) : (
                  group.categories.map((row: RevenueCompositionBucket) => (
                    <tr key={row.id} className="border-t border-gray-100">
                      <td className="px-4 py-2.5 text-gray-900">{row.label}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">
                        {formatNumber(row.quantity)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-gray-900">
                        {formatRupiah(row.sales)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">
                        {formatRupiah(row.cost)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">
                        {formatRupiah(row.margin)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-gray-900">
                        {formatPct(row.cost_pct)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-gray-500">
                        {formatPct(measure === "amount" ? row.sales_share_pct : row.qty_share_pct)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function RevenueCompositionReportPage() {
  const [dateFrom, setDateFrom] = useState(firstDayOfMonthWib);
  const [dateTo, setDateTo] = useState(todayWib);
  const [measure, setMeasure] = useState<Measure>("amount");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    food: true,
    beverage: true,
  });

  const { data: report, isFetching, error } = useRevenueCompositionReport({
    date_from: dateFrom,
    date_to: dateTo,
  });

  const summary = report?.summary;
  const groups = useMemo(() => report?.groups || [], [report?.groups]);
  const food = groups.find((g) => g.id === "food");
  const beverage = groups.find((g) => g.id === "beverage");
  const errorMessage = error instanceof Error ? error.message : null;
  const isAmount = measure === "amount";

  return (
    <TooltipProvider>
      <PageTransition>
        <div className="space-y-6">
          <PurchasingPageHeader
            title="Revenue Composition"
            description="Komposisi Food dan Beverage — penjualan, HPP, dan margin dari snapshot order yang sudah dibayar"
            actions={
              <div className="flex w-full flex-col gap-3 rounded-lg border border-gray-200/70 bg-white p-3 sm:flex-row sm:items-end">
                <div className="space-y-1.5">
                  <Label className="text-xs text-gray-600">Dari</Label>
                  <Input
                    type="date"
                    value={dateFrom}
                    onChange={(event) => setDateFrom(event.target.value)}
                    className="h-9 w-full text-sm focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20 sm:w-40"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-gray-600">Sampai</Label>
                  <Input
                    type="date"
                    value={dateTo}
                    onChange={(event) => setDateTo(event.target.value)}
                    className="h-9 w-full text-sm focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20 sm:w-40"
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="purchasing-secondary-button h-9 w-full sm:w-auto"
                  onClick={() => {
                    const current = todayWib();
                    setDateFrom(current);
                    setDateTo(current);
                  }}
                >
                  Hari ini
                </Button>
              </div>
            }
          />

          {errorMessage && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200/80 bg-red-50 p-4 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {errorMessage}
            </div>
          )}

          {isFetching && !report ? (
            <div className="flex items-center justify-center gap-2 py-20 text-gray-500">
              <Loader2 className="h-5 w-5 animate-spin text-brand-text" />
              <span className="text-sm">Memuat komposisi pendapatan...</span>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <FadeIn delay={0}>
                  <MetricCard
                    title="Total Sales"
                    value={formatRupiah(summary?.sales || 0)}
                    helper={`${summary?.orders || 0} order dibayar · ${formatNumber(summary?.quantity || 0)} porsi`}
                    icon={WalletCards}
                  />
                </FadeIn>
                <FadeIn delay={0.05}>
                  <MetricCard
                    title="Food Sales"
                    value={isAmount ? formatRupiah(food?.sales || 0) : `${formatNumber(food?.quantity || 0)} porsi`}
                    helper={`Food cost ${formatPct(food?.cost_pct || 0)} · ${formatPct(
                      isAmount ? food?.sales_share_pct || 0 : food?.qty_share_pct || 0
                    )} dari total`}
                    icon={UtensilsCrossed}
                  />
                </FadeIn>
                <FadeIn delay={0.1}>
                  <MetricCard
                    title="Beverage Sales"
                    value={
                      isAmount
                        ? formatRupiah(beverage?.sales || 0)
                        : `${formatNumber(beverage?.quantity || 0)} porsi`
                    }
                    helper={`Beverage cost ${formatPct(beverage?.cost_pct || 0)} · ${formatPct(
                      isAmount ? beverage?.sales_share_pct || 0 : beverage?.qty_share_pct || 0
                    )} dari total`}
                    icon={CupSoda}
                  />
                </FadeIn>
                <FadeIn delay={0.15}>
                  <MetricCard
                    title="Total Cost"
                    value={formatRupiah(summary?.cost || 0)}
                    helper={`${formatPct(summary?.cost_pct || 0)} dari penjualan`}
                    icon={Percent}
                  />
                </FadeIn>
              </div>

              <Card className="border-gray-200/70 shadow-xs">
                <CardContent className="space-y-3 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-gray-900">
                        Proporsi {isAmount ? "nilai penjualan" : "jumlah porsi"}
                      </div>
                      <div className="text-xs text-gray-500">
                        Food {formatPct(isAmount ? food?.sales_share_pct || 0 : food?.qty_share_pct || 0)}
                        {" · "}
                        Beverage{" "}
                        {formatPct(
                          isAmount ? beverage?.sales_share_pct || 0 : beverage?.qty_share_pct || 0
                        )}
                      </div>
                    </div>

                    {/* Satu laporan, dua cara baca: rupiah atau porsi. */}
                    <div
                      className="inline-flex rounded-lg border border-gray-200 p-0.5"
                      role="group"
                      aria-label="Ukuran"
                    >
                      {(["amount", "qty"] as Measure[]).map((option) => (
                        <button
                          key={option}
                          type="button"
                          onClick={() => setMeasure(option)}
                          aria-pressed={measure === option}
                          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                            measure === option
                              ? "bg-primary text-primary-foreground"
                              : "text-gray-600 hover:bg-gray-50"
                          }`}
                        >
                          {option === "amount" ? "Amount" : "Qty"}
                        </button>
                      ))}
                    </div>
                  </div>

                  <ShareBar
                    food={isAmount ? food?.sales || 0 : food?.quantity || 0}
                    beverage={isAmount ? beverage?.sales || 0 : beverage?.quantity || 0}
                  />

                  <div className="flex flex-wrap gap-4 text-xs text-gray-600">
                    <span className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full bg-amber-500" aria-hidden />
                      Food
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full bg-sky-500" aria-hidden />
                      Beverage
                    </span>
                  </div>
                </CardContent>
              </Card>

              <div className="space-y-3">
                {groups.map((group) => (
                  <GroupSection
                    key={group.id}
                    group={group}
                    measure={measure}
                    expanded={Boolean(expanded[group.id])}
                    onToggle={() =>
                      setExpanded((prev) => ({ ...prev, [group.id]: !prev[group.id] }))
                    }
                  />
                ))}
              </div>

              {Boolean(summary?.zero_cost_items) && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200/80 bg-amber-50 p-3 text-xs text-amber-800">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    {summary?.zero_cost_items} baris penjualan belum punya HPP, sehingga cost% di
                    atas lebih rendah dari kenyataan. Lengkapi BOM produknya agar angka ini akurat.
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      </PageTransition>
    </TooltipProvider>
  );
}
