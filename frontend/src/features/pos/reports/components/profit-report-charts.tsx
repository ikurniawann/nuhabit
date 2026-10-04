"use client";

import { useMemo } from "react";
import type { ApexOptions } from "apexcharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatRupiah } from "@/lib/format";
import type { ProfitBucket } from "@/lib/pos/reports/types";
import { ApexChart } from "./apex-chart";
import { useBrandPrimary } from "../use-brand-primary";

const CHART_SECONDARY_COLORS = ["#9ca3af", "#6366f1", "#f59e0b", "#14b8a6", "#8b5cf6"];

const baseChartOptions: ApexOptions = {
  chart: {
    fontFamily: "inherit",
    toolbar: { show: false },
    zoom: { enabled: false },
  },
  grid: {
    borderColor: "#f3f4f6",
    strokeDashArray: 4,
  },
  dataLabels: { enabled: false },
  legend: {
    fontSize: "12px",
    labels: { colors: "#6b7280" },
  },
  tooltip: {
    theme: "light",
    y: {
      formatter: (value) => formatRupiah(value),
    },
  },
};

function truncateLabel(label: string, max = 18) {
  return label.length > max ? `${label.slice(0, max)}…` : label;
}

function sortByDate(rows: ProfitBucket[]) {
  return [...rows].sort((a, b) => a.label.localeCompare(b.label));
}

function topRows(rows: ProfitBucket[], limit = 8) {
  return [...rows].sort((a, b) => b.gross_profit - a.gross_profit).slice(0, limit);
}

export function ProfitDailyTrendChart({ rows }: { rows: ProfitBucket[] }) {
  const brandPrimary = useBrandPrimary();
  const sorted = useMemo(() => sortByDate(rows), [rows]);

  const options = useMemo<ApexOptions>(
    () => ({
      ...baseChartOptions,
      chart: { ...baseChartOptions.chart, type: "area" },
      colors: [brandPrimary, "#9ca3af", "#6366f1"],
      stroke: { curve: "smooth", width: 2 },
      fill: {
        type: "gradient",
        gradient: { shadeIntensity: 0.2, opacityFrom: 0.35, opacityTo: 0.05 },
      },
      xaxis: {
        categories: sorted.map((row) => row.label),
        labels: { style: { colors: "#9ca3af", fontSize: "11px" } },
        axisBorder: { show: false },
        axisTicks: { show: false },
      },
      yaxis: {
        labels: {
          style: { colors: "#9ca3af", fontSize: "11px" },
          formatter: (value) => formatRupiah(value),
        },
      },
    }),
    [sorted, brandPrimary]
  );

  const series = useMemo(
    () => [
      { name: "Revenue", data: sorted.map((row) => row.revenue) },
      { name: "COGS", data: sorted.map((row) => row.cogs) },
      { name: "Gross Profit", data: sorted.map((row) => row.gross_profit) },
    ],
    [sorted]
  );

  if (sorted.length === 0) {
    return <ChartEmptyState title="Daily Trend" message="No daily profit data for this period." />;
  }

  return (
    <Card className="border-gray-200/70 shadow-xs">
      <CardHeader className="border-b border-gray-200/70 pb-3">
        <CardTitle className="text-base font-semibold text-gray-900">Daily Trend</CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <ApexChart type="area" series={series} options={options} height={300} />
      </CardContent>
    </Card>
  );
}

export function ProfitCompositionChart({
  revenue,
  cogs,
  grossProfit,
}: {
  revenue: number;
  cogs: number;
  grossProfit: number;
}) {
  const brandPrimary = useBrandPrimary();
  const hasData = revenue > 0 || cogs > 0 || grossProfit > 0;

  const options = useMemo<ApexOptions>(
    () => ({
      ...baseChartOptions,
      chart: { ...baseChartOptions.chart, type: "donut" },
      colors: [brandPrimary, "#9ca3af"],
      labels: ["Gross Profit", "COGS"],
      plotOptions: {
        pie: {
          donut: {
            size: "68%",
            labels: {
              show: true,
              total: {
                show: true,
                label: "Revenue",
                formatter: () => formatRupiah(revenue),
                color: "#111827",
                fontSize: "14px",
                fontWeight: 600,
              },
              value: {
                formatter: (value) => formatRupiah(Number(value)),
              },
            },
          },
        },
      },
      tooltip: {
        ...baseChartOptions.tooltip,
        y: { formatter: (value) => formatRupiah(value) },
      },
    }),
    [revenue, brandPrimary]
  );

  const series = useMemo(() => [grossProfit, cogs], [grossProfit, cogs]);

  if (!hasData) {
    return <ChartEmptyState title="Revenue Composition" message="No revenue data for this period." />;
  }

  return (
    <Card className="border-gray-200/70 shadow-xs">
      <CardHeader className="border-b border-gray-200/70 pb-3">
        <CardTitle className="text-base font-semibold text-gray-900">Revenue Composition</CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <ApexChart type="donut" series={series} options={options} height={300} />
      </CardContent>
    </Card>
  );
}

export function ProfitCategoryBarChart({ rows, title }: { rows: ProfitBucket[]; title: string }) {
  const brandPrimary = useBrandPrimary();
  const top = useMemo(() => topRows(rows), [rows]);
  const chartColors = useMemo(
    () => [brandPrimary, ...CHART_SECONDARY_COLORS],
    [brandPrimary]
  );

  const options = useMemo<ApexOptions>(
    () => ({
      ...baseChartOptions,
      chart: { ...baseChartOptions.chart, type: "bar" },
      colors: chartColors,
      plotOptions: {
        bar: {
          horizontal: true,
          borderRadius: 4,
          barHeight: "62%",
        },
      },
      xaxis: {
        categories: top.map((row) => truncateLabel(row.label)),
        labels: {
          style: { colors: "#9ca3af", fontSize: "11px" },
          formatter: (value) => formatRupiah(Number(value)),
        },
        axisBorder: { show: false },
        axisTicks: { show: false },
      },
      yaxis: {
        labels: { style: { colors: "#6b7280", fontSize: "11px" } },
      },
      tooltip: {
        ...baseChartOptions.tooltip,
        y: { formatter: (value) => formatRupiah(value) },
      },
    }),
    [top, chartColors]
  );

  const series = useMemo(
    () => [{ name: "Gross Profit", data: top.map((row) => row.gross_profit) }],
    [top]
  );

  if (top.length === 0) {
    return <ChartEmptyState title={title} message="No category profit data for this period." />;
  }

  return (
    <Card className="border-gray-200/70 shadow-xs">
      <CardHeader className="border-b border-gray-200/70 pb-3">
        <CardTitle className="text-base font-semibold text-gray-900">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <ApexChart type="bar" series={series} options={options} height={280} />
      </CardContent>
    </Card>
  );
}

export function ProfitMarginBarChart({ rows }: { rows: ProfitBucket[] }) {
  const brandPrimary = useBrandPrimary();
  const top = useMemo(() => topRows(rows), [rows]);

  const options = useMemo<ApexOptions>(
    () => ({
      ...baseChartOptions,
      chart: { ...baseChartOptions.chart, type: "bar" },
      colors: [brandPrimary],
      plotOptions: {
        bar: {
          borderRadius: 4,
          columnWidth: "52%",
        },
      },
      xaxis: {
        categories: top.map((row) => truncateLabel(row.label, 12)),
        labels: { style: { colors: "#9ca3af", fontSize: "11px" }, rotate: -35 },
        axisBorder: { show: false },
        axisTicks: { show: false },
      },
      yaxis: {
        labels: {
          style: { colors: "#9ca3af", fontSize: "11px" },
          formatter: (value) => `${value}%`,
        },
        max: 100,
      },
      tooltip: {
        ...baseChartOptions.tooltip,
        y: { formatter: (value) => `${Number(value).toFixed(2)}%` },
      },
    }),
    [top, brandPrimary]
  );

  const series = useMemo(
    () => [{ name: "Gross Margin", data: top.map((row) => row.gross_margin_pct) }],
    [top]
  );

  if (top.length === 0) {
    return (
      <ChartEmptyState title="Top Product Margin" message="No product margin data for this period." />
    );
  }

  return (
    <Card className="border-gray-200/70 shadow-xs">
      <CardHeader className="border-b border-gray-200/70 pb-3">
        <CardTitle className="text-base font-semibold text-gray-900">Top Product Margin</CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <ApexChart type="bar" series={series} options={options} height={280} />
      </CardContent>
    </Card>
  );
}

function ChartEmptyState({ title, message }: { title: string; message: string }) {
  return (
    <Card className="border-gray-200/70 shadow-xs">
      <CardHeader className="border-b border-gray-200/70 pb-3">
        <CardTitle className="text-base font-semibold text-gray-900">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex min-h-[280px] items-center justify-center p-6 text-sm text-gray-400">
        {message}
      </CardContent>
    </Card>
  );
}
