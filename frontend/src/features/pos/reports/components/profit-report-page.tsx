"use client";

import { useMemo, useState } from "react";
import {
  AlertCircle,
  BarChart3,
  CalendarDays,
  ChevronDown,
  ChevronsUpDown,
  ChevronUp,
  Loader2,
  Package,
  ReceiptText,
  TrendingUp,
  Users,
  WalletCards,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FadeIn, PageTransition } from "@/components/motion";
import { TooltipProvider } from "@/components/ui/tooltip";
import { firstDayOfMonthWib, todayWib } from "@/lib/pos/report-dates";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { PurchasingPageHeader } from "@/features/purchasing/components/shared/purchasing-page-header";
import type { ProfitBucket } from "@/lib/pos/reports/types";
import { useProfitReport } from "../queries";
import { isPosGroupCategory } from "@/lib/pos/profit-category";
import {
  ProfitCategoryBarChart,
  ProfitCompositionChart,
  ProfitDailyTrendChart,
  ProfitMarginBarChart,
} from "./profit-report-charts";
import { formatNumber, formatRupiah } from "@/lib/format";

const formatQty = (value: number) => formatNumber(value, 2);

function MetricCard({
  title,
  value,
  helper,
  icon: Icon,
}: {
  title: string;
  value: string;
  helper: string;
  icon: typeof BarChart3;
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

type BreakdownSortKey = "label" | "quantity" | "revenue" | "cogs" | "gross_profit" | "gross_margin_pct";

const BREAKDOWN_COLUMNS: Array<{ key: BreakdownSortKey; label: string; align: "left" | "right" }> = [
  { key: "label", label: "Name", align: "left" },
  { key: "quantity", label: "Qty", align: "right" },
  { key: "revenue", label: "Revenue", align: "right" },
  { key: "cogs", label: "COGS", align: "right" },
  { key: "gross_profit", label: "Gross Profit", align: "right" },
  { key: "gross_margin_pct", label: "Margin", align: "right" },
];

function BreakdownTableSection({
  icon: Icon,
  title,
  description,
  rows,
}: {
  icon: typeof Package;
  title: string;
  description: string;
  rows: ProfitBucket[];
}) {
  // null = biarkan urutan bawaan API (revenue tertinggi dulu)
  const [sortKey, setSortKey] = useState<BreakdownSortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  function toggleSort(key: BreakdownSortKey) {
    if (sortKey === key) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // Kolom angka mulai dari terbesar; nama mulai dari A.
      setSortDir(key === "label" ? "asc" : "desc");
    }
  }

  function sortIcon(key: BreakdownSortKey) {
    if (sortKey !== key) return <ChevronsUpDown className="h-3.5 w-3.5 text-gray-300" />;
    return sortDir === "asc" ? (
      <ChevronUp className="h-3.5 w-3.5 text-brand-text" />
    ) : (
      <ChevronDown className="h-3.5 w-3.5 text-brand-text" />
    );
  }

  const sortedRows = useMemo(() => {
    if (!sortKey) return rows;
    const factor = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      if (sortKey === "label") return factor * a.label.localeCompare(b.label, "id");
      return factor * ((Number(a[sortKey]) || 0) - (Number(b[sortKey]) || 0));
    });
  }, [rows, sortKey, sortDir]);

  return (
    <PurchasingListSection icon={Icon} title={title} description={description}>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              {BREAKDOWN_COLUMNS.map((column) => (
                <th
                  key={column.key}
                  aria-sort={
                    sortKey === column.key ? (sortDir === "asc" ? "ascending" : "descending") : "none"
                  }
                  className={`px-4 py-3 font-semibold ${
                    column.align === "right" ? "text-right" : "text-left"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => toggleSort(column.key)}
                    className={`inline-flex items-center gap-1 hover:text-gray-800 ${
                      column.align === "right" ? "flex-row-reverse" : ""
                    }`}
                  >
                    {column.label} {sortIcon(column.key)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sortedRows.length > 0 ? (
              sortedRows.map((row) => (
                <tr key={row.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{row.label}</td>
                  <td className="px-4 py-3 text-right text-gray-700">{formatQty(row.quantity)}</td>
                  <td className="px-4 py-3 text-right text-gray-700">{formatRupiah(row.revenue)}</td>
                  <td className="px-4 py-3 text-right text-gray-700">{formatRupiah(row.cogs)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-900">
                    {formatRupiah(row.gross_profit)}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-brand-text">
                    {formatQty(row.gross_margin_pct)}%
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-gray-400">
                  No profit data for this period
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </PurchasingListSection>
  );
}

export function ProfitReportPage() {
  const [dateFrom, setDateFrom] = useState(firstDayOfMonthWib);
  const [dateTo, setDateTo] = useState(todayWib);

  const { data: report, isLoading, isFetching, error } = useProfitReport({
    date_from: dateFrom,
    date_to: dateTo,
  });

  const loading = isLoading || isFetching;
  const errorMessage = error instanceof Error ? error.message : "";
  const summary = report?.summary;
  const breakdowns = report?.breakdowns;
  const categoryRows = useMemo(
    () => (breakdowns?.categories || []).filter((row) => !isPosGroupCategory(row.label)),
    [breakdowns?.categories]
  );

  return (
    <TooltipProvider>
      <PageTransition>
        <div className="space-y-6">
          <PurchasingPageHeader
            title="POS Profit Report"
            description="Revenue, COGS, gross profit, and margin based on paid order item snapshots"
            actions={
              <div className="flex w-full flex-col gap-3 rounded-lg border border-gray-200/70 bg-white p-3 sm:flex-row sm:items-end">
                <div className="space-y-1.5">
                  <Label className="text-xs text-gray-600">From</Label>
                  <Input
                    type="date"
                    value={dateFrom}
                    onChange={(event) => setDateFrom(event.target.value)}
                    className="h-9 w-full text-sm focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20 sm:w-40"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-gray-600">To</Label>
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
                  Today
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

          {loading && !report ? (
            <div className="flex items-center justify-center gap-2 py-20 text-gray-500">
              <Loader2 className="h-5 w-5 animate-spin text-brand-text" />
              <span className="text-sm">Loading profit report...</span>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <FadeIn delay={0}>
                  <MetricCard
                    title="Revenue"
                    value={formatRupiah(summary?.revenue || 0)}
                    helper={`${summary?.orders || 0} paid/completed orders`}
                    icon={WalletCards}
                  />
                </FadeIn>
                <FadeIn delay={0.05}>
                  <MetricCard
                    title="COGS"
                    value={formatRupiah(summary?.cogs || 0)}
                    helper={`${summary?.items || 0} items with cost snapshot`}
                    icon={ReceiptText}
                  />
                </FadeIn>
                <FadeIn delay={0.1}>
                  <MetricCard
                    title="Gross Profit"
                    value={formatRupiah(summary?.gross_profit || 0)}
                    helper={`${formatQty(summary?.gross_margin_pct || 0)}% gross margin`}
                    icon={TrendingUp}
                  />
                </FadeIn>
                <FadeIn delay={0.15}>
                  <MetricCard
                    title="Zero Cost Items"
                    value={formatQty(summary?.zero_cost_items || 0)}
                    helper="Revenue items with zero cost price"
                    icon={CalendarDays}
                  />
                </FadeIn>
              </div>

              <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
                <div className="xl:col-span-8">
                  <ProfitDailyTrendChart rows={breakdowns?.dates || []} />
                </div>
                <div className="xl:col-span-4">
                  <ProfitCompositionChart
                    revenue={summary?.revenue || 0}
                    cogs={summary?.cogs || 0}
                    grossProfit={summary?.gross_profit || 0}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                <ProfitCategoryBarChart rows={categoryRows} title="Top Categories" />
                <ProfitMarginBarChart rows={breakdowns?.products || []} />
              </div>

              <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                <BreakdownTableSection
                  icon={Package}
                  title="Product Breakdown"
                  description="Profit contribution by product"
                  rows={breakdowns?.products || []}
                />
                <BreakdownTableSection
                  icon={BarChart3}
                  title="Category Breakdown"
                  description="Profit contribution by category"
                  rows={categoryRows}
                />
                <BreakdownTableSection
                  icon={ReceiptText}
                  title="Station Breakdown"
                  description="Profit contribution by kitchen station"
                  rows={breakdowns?.stations || []}
                />
                <BreakdownTableSection
                  icon={Users}
                  title="Cashier Breakdown"
                  description="Profit contribution by cashier"
                  rows={breakdowns?.cashiers || []}
                />
              </div>

              <BreakdownTableSection
                icon={CalendarDays}
                title="Daily Trend"
                description="Day-by-day revenue, COGS, and gross profit"
                rows={breakdowns?.dates || []}
              />
            </>
          )}
        </div>
      </PageTransition>
    </TooltipProvider>
  );
}
