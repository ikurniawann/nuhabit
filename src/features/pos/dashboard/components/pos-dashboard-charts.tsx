"use client";

import { useEffect, useMemo, useState } from "react";
import type { ApexOptions } from "apexcharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatAmount } from "@/lib/purchasing/utils";
import { ApexChart } from "@/features/pos/reports/components/apex-chart";
import type { TopProduct, TrendPoint } from "../types";

function useBrandPrimary(fallback = "#00281a") {
  const [color, setColor] = useState(fallback);
  useEffect(() => {
    if (typeof window !== "undefined") {
      const v = getComputedStyle(document.documentElement)
        .getPropertyValue("--brand-primary")
        .trim();
      if (v) setColor(v);
    }
  }, []);
  return color;
}

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
  tooltip: { theme: "light" },
};

function ChartEmpty({ title, message }: { title: string; message: string }) {
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

export function PosRevenueTrendChart({ points }: { points: TrendPoint[] }) {
  const brandPrimary = useBrandPrimary();
  const options = useMemo<ApexOptions>(
    () => ({
      ...baseChartOptions,
      chart: { ...baseChartOptions.chart, type: "area" },
      colors: [brandPrimary],
      stroke: { curve: "smooth", width: 2 },
      fill: {
        type: "gradient",
        gradient: { shadeIntensity: 0.2, opacityFrom: 0.35, opacityTo: 0.05 },
      },
      xaxis: {
        categories: points.map((point) => point.label),
        labels: { style: { colors: "#9ca3af", fontSize: "11px" } },
        axisBorder: { show: false },
        axisTicks: { show: false },
      },
      yaxis: {
        labels: {
          style: { colors: "#9ca3af", fontSize: "11px" },
          formatter: (value) => formatAmount(value),
        },
      },
      tooltip: {
        ...baseChartOptions.tooltip,
        y: { formatter: (value) => formatAmount(value) },
      },
    }),
    [points, brandPrimary]
  );

  const series = useMemo(
    () => [{ name: "Revenue", data: points.map((point) => point.revenue) }],
    [points]
  );

  if (points.length === 0) {
    return <ChartEmpty title="Revenue Trend" message="No revenue data for this period." />;
  }

  return (
    <Card className="border-gray-200/70 shadow-xs">
      <CardHeader className="border-b border-gray-200/70 pb-3">
        <CardTitle className="text-base font-semibold text-gray-900">Revenue Trend</CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <ApexChart type="area" series={series} options={options} height={280} />
      </CardContent>
    </Card>
  );
}

export function PosArkXpTrendChart({ points }: { points: TrendPoint[] }) {
  const options = useMemo<ApexOptions>(
    () => ({
      ...baseChartOptions,
      chart: { ...baseChartOptions.chart, type: "line" },
      colors: ["#f59e0b", "#6366f1"],
      stroke: { curve: "smooth", width: 2 },
      xaxis: {
        categories: points.map((point) => point.label),
        labels: { style: { colors: "#9ca3af", fontSize: "11px" } },
        axisBorder: { show: false },
        axisTicks: { show: false },
      },
      yaxis: [
        {
          title: { text: "ARK Used", style: { color: "#9ca3af", fontSize: "11px" } },
          labels: {
            style: { colors: "#9ca3af", fontSize: "11px" },
            formatter: (value) => formatArkAxis(value),
          },
        },
        {
          opposite: true,
          title: { text: "XP Earned", style: { color: "#9ca3af", fontSize: "11px" } },
          labels: {
            style: { colors: "#9ca3af", fontSize: "11px" },
            formatter: (value) => `${Math.round(value)}`,
          },
        },
      ],
      tooltip: {
        shared: true,
        intersect: false,
        y: [
          { formatter: (value) => formatArk(value) },
          { formatter: (value) => `${Math.round(Number(value))} XP` },
        ],
      },
    }),
    [points]
  );

  const series = useMemo(
    () => [
      { name: "ARK Used", type: "line", data: points.map((point) => point.arkUsed) },
      { name: "XP Earned", type: "line", data: points.map((point) => point.xpEarned) },
    ],
    [points]
  );

  if (points.length === 0 || points.every((point) => point.arkUsed === 0 && point.xpEarned === 0)) {
    return <ChartEmpty title="ARK & XP Activity" message="No ARK or XP activity for this period." />;
  }

  return (
    <Card className="border-gray-200/70 shadow-xs">
      <CardHeader className="border-b border-gray-200/70 pb-3">
        <CardTitle className="text-base font-semibold text-gray-900">ARK & XP Activity</CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <ApexChart type="line" series={series} options={options} height={280} />
      </CardContent>
    </Card>
  );
}

export function PosTopProductsChart({ products }: { products: TopProduct[] }) {
  const brandPrimary = useBrandPrimary();
  const options = useMemo<ApexOptions>(
    () => ({
      ...baseChartOptions,
      chart: { ...baseChartOptions.chart, type: "bar" },
      colors: [brandPrimary],
      plotOptions: {
        bar: {
          horizontal: true,
          borderRadius: 4,
          barHeight: "62%",
        },
      },
      xaxis: {
        categories: products.map((product) =>
          product.name.length > 20 ? `${product.name.slice(0, 20)}…` : product.name
        ),
        labels: {
          style: { colors: "#9ca3af", fontSize: "11px" },
          formatter: (value) => String(value),
        },
      },
      yaxis: {
        labels: { style: { colors: "#6b7280", fontSize: "11px" } },
      },
      tooltip: {
        ...baseChartOptions.tooltip,
        y: { formatter: (value) => `${value} sold` },
      },
    }),
    [products, brandPrimary]
  );

  const series = useMemo(
    () => [{ name: "Qty Sold", data: products.map((product) => product.sold) }],
    [products]
  );

  if (products.length === 0) {
    return <ChartEmpty title="Top Products" message="No product sales for this period." />;
  }

  return (
    <Card className="border-gray-200/70 shadow-xs">
      <CardHeader className="border-b border-gray-200/70 pb-3">
        <CardTitle className="text-base font-semibold text-gray-900">Top Products</CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <ApexChart type="bar" series={series} options={options} height={260} />
      </CardContent>
    </Card>
  );
}

export function PosArkPaymentShareChart({
  arkOrders,
  otherOrders,
}: {
  arkOrders: number;
  otherOrders: number;
}) {
  const hasData = arkOrders > 0 || otherOrders > 0;

  const options = useMemo<ApexOptions>(
    () => ({
      ...baseChartOptions,
      chart: { ...baseChartOptions.chart, type: "donut" },
      colors: ["#f59e0b", "#e5e7eb"],
      labels: ["ARK Payment", "Other Payment"],
      plotOptions: {
        pie: {
          donut: {
            size: "68%",
            labels: {
              show: true,
              total: {
                show: true,
                label: "Orders",
                formatter: (w) => {
                  const total = w.globals.seriesTotals.reduce((sum, value) => sum + value, 0);
                  return String(Math.round(total));
                },
                color: "#111827",
                fontSize: "14px",
                fontWeight: 600,
              },
              value: {
                formatter: (value) => String(Math.round(Number(value))),
              },
            },
          },
        },
      },
      tooltip: {
        y: {
          formatter: (value) => `${Math.round(Number(value))} orders`,
        },
      },
    }),
    []
  );

  const series = useMemo(() => [arkOrders, otherOrders], [arkOrders, otherOrders]);

  if (!hasData) {
    return <ChartEmpty title="ARK Payment Share" message="No completed orders for this period." />;
  }

  return (
    <Card className="border-gray-200/70 shadow-xs">
      <CardHeader className="border-b border-gray-200/70 pb-3">
        <CardTitle className="text-base font-semibold text-gray-900">ARK Payment Share</CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <ApexChart type="donut" series={series} options={options} height={280} />
      </CardContent>
    </Card>
  );
}

export function formatArk(value: number) {
  return `${(value / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 })} ARK`;
}

function formatArkAxis(value: number) {
  return `${(value / 1000).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}
