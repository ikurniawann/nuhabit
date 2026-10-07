"use client";

import { useMemo, useSyncExternalStore } from "react";
import type { ApexOptions } from "apexcharts";
import { ApexChart } from "@/features/pos/reports/components/apex-chart";
import type { AccountingDashboard } from "@/lib/accounting/dashboard-store";
import { formatLedgerAmount } from "@/lib/accounting/format";

const FALLBACK_PRIMARY = "#00281a";

const noSubscribe = () => () => {};

/** Warna brand dari CSS var (server render memakai fallback). */
function useBrandPrimary() {
  return useSyncExternalStore(
    noSubscribe,
    () =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--brand-primary")
        .trim() || FALLBACK_PRIMARY,
    () => FALLBACK_PRIMARY,
  );
}

/** Label sumbu grafik ringkas tanpa "Rp" ("1.2jt"); sengaja beda dari formatRupiahCompact. */
function formatCompact(n: number) {
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}M`;
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}jt`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(0)}rb`;
  return formatLedgerAmount(n);
}

const baseOptions: ApexOptions = {
  chart: {
    fontFamily: "inherit",
    toolbar: { show: false },
    zoom: { enabled: false },
    animations: { enabled: true },
  },
  grid: {
    borderColor: "rgba(229, 231, 235, 0.8)",
    strokeDashArray: 4,
    padding: { left: 8, right: 8 },
  },
  dataLabels: { enabled: false },
  legend: {
    fontSize: "12px",
    fontWeight: 500,
    labels: { colors: "#64748b" },
    markers: { size: 5, offsetX: -2 },
  },
  tooltip: {
    theme: "light",
    style: { fontSize: "12px" },
  },
};

function ChartEmpty({ message }: { message: string }) {
  return (
    <div className="flex h-70 items-center justify-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}

export function BalanceCompositionChart({
  rows,
}: {
  rows: AccountingDashboard["balance_composition"];
}) {
  const brandPrimary = useBrandPrimary();
  const filtered = useMemo(() => rows.filter((r) => r.value > 0), [rows]);

  const options = useMemo<ApexOptions>(
    () => ({
      ...baseOptions,
      chart: { ...baseOptions.chart, type: "donut" },
      colors: [brandPrimary, "#64748b", "#94a3b8"],
      labels: filtered.map((r) => r.name),
      stroke: { width: 2, colors: ["#fff"] },
      plotOptions: {
        pie: {
          donut: {
            size: "68%",
            labels: {
              show: true,
              name: {
                show: true,
                fontSize: "13px",
                color: "#64748b",
              },
              value: {
                show: true,
                fontSize: "16px",
                fontWeight: 600,
                color: "#0f172a",
                formatter: (val) => formatCompact(Number(val)),
              },
              total: {
                show: true,
                label: "Total",
                fontSize: "12px",
                color: "#94a3b8",
                formatter: (w) =>
                  formatCompact(
                    w.globals.seriesTotals.reduce(
                      (a: number, b: number) => a + b,
                      0,
                    ),
                  ),
              },
            },
          },
        },
      },
      legend: {
        ...baseOptions.legend,
        position: "bottom",
      },
      tooltip: {
        ...baseOptions.tooltip,
        y: { formatter: (v) => formatLedgerAmount(v) },
      },
    }),
    [filtered, brandPrimary],
  );

  const series = useMemo(() => filtered.map((r) => r.value), [filtered]);

  if (filtered.length === 0) {
    return <ChartEmpty message="Belum ada saldo neraca" />;
  }

  return (
    <ApexChart type="donut" series={series} options={options} height={300} />
  );
}

export function PnlBreakdownChart({
  rows,
}: {
  rows: AccountingDashboard["pnl_breakdown"];
}) {
  const brandPrimary = useBrandPrimary();

  const colors = useMemo(
    () => [brandPrimary, "#f59e0b", "#ef4444", "#22c55e", "#f97316"],
    [brandPrimary],
  );

  const options = useMemo<ApexOptions>(
    () => ({
      ...baseOptions,
      chart: { ...baseOptions.chart, type: "bar" },
      colors,
      plotOptions: {
        bar: {
          borderRadius: 6,
          columnWidth: "48%",
          distributed: true,
        },
      },
      legend: { show: false },
      xaxis: {
        categories: rows.map((r) => r.name),
        labels: {
          style: { colors: "#94a3b8", fontSize: "11px" },
          rotate: -15,
          rotateAlways: false,
        },
        axisBorder: { show: false },
        axisTicks: { show: false },
      },
      yaxis: {
        labels: {
          style: { colors: "#94a3b8", fontSize: "11px" },
          formatter: (v) => formatCompact(v),
        },
      },
      tooltip: {
        ...baseOptions.tooltip,
        y: { formatter: (v) => formatLedgerAmount(v) },
      },
    }),
    [rows, colors],
  );

  const series = useMemo(
    () => [{ name: "Nilai", data: rows.map((r) => r.value) }],
    [rows],
  );

  if (rows.every((r) => r.value === 0)) {
    return <ChartEmpty message="Belum ada mutasi laba rugi" />;
  }

  return (
    <ApexChart type="bar" series={series} options={options} height={300} />
  );
}

export function MonthlyTrendChart({
  rows,
}: {
  rows: AccountingDashboard["monthly_trend"];
}) {
  const brandPrimary = useBrandPrimary();

  const options = useMemo<ApexOptions>(
    () => ({
      ...baseOptions,
      chart: { ...baseOptions.chart, type: "area" },
      colors: [brandPrimary, "#ef4444", "#16a34a"],
      stroke: { curve: "smooth", width: 2.5 },
      fill: {
        type: "gradient",
        gradient: {
          shadeIntensity: 0.25,
          opacityFrom: 0.35,
          opacityTo: 0.04,
        },
      },
      markers: {
        size: 3,
        strokeWidth: 0,
        hover: { size: 5 },
      },
      xaxis: {
        categories: rows.map((r) => r.month),
        labels: { style: { colors: "#94a3b8", fontSize: "11px" } },
        axisBorder: { show: false },
        axisTicks: { show: false },
      },
      yaxis: {
        labels: {
          style: { colors: "#94a3b8", fontSize: "11px" },
          formatter: (v) => formatCompact(v),
        },
      },
      tooltip: {
        shared: true,
        intersect: false,
        y: { formatter: (v) => formatLedgerAmount(v) },
      },
    }),
    [rows, brandPrimary],
  );

  const series = useMemo(
    () => [
      { name: "Revenue", data: rows.map((r) => r.revenue) },
      { name: "Expense", data: rows.map((r) => r.expense) },
      { name: "Net", data: rows.map((r) => r.net) },
    ],
    [rows],
  );

  if (rows.length === 0) {
    return <ChartEmpty message="Belum ada tren periode" />;
  }

  return (
    <ApexChart type="area" series={series} options={options} height={300} />
  );
}

export function CashFlowChart({
  rows,
}: {
  rows: AccountingDashboard["cash_flow_breakdown"];
}) {
  const brandPrimary = useBrandPrimary();

  const colors = useMemo(
    () => [brandPrimary, "#0ea5e9", "#8b5cf6"],
    [brandPrimary],
  );

  const options = useMemo<ApexOptions>(
    () => ({
      ...baseOptions,
      chart: { ...baseOptions.chart, type: "bar" },
      colors,
      plotOptions: {
        bar: {
          borderRadius: 6,
          columnWidth: "42%",
          distributed: true,
        },
      },
      legend: { show: false },
      xaxis: {
        categories: rows.map((r) => r.name),
        labels: { style: { colors: "#94a3b8", fontSize: "11px" } },
        axisBorder: { show: false },
        axisTicks: { show: false },
      },
      yaxis: {
        labels: {
          style: { colors: "#94a3b8", fontSize: "11px" },
          formatter: (v) => formatCompact(v),
        },
      },
      tooltip: {
        ...baseOptions.tooltip,
        y: { formatter: (v) => formatLedgerAmount(v) },
      },
    }),
    [rows, colors],
  );

  const series = useMemo(
    () => [{ name: "Nilai", data: rows.map((r) => r.value) }],
    [rows],
  );

  if (rows.every((r) => r.value === 0)) {
    return <ChartEmpty message="Belum ada arus kas di periode ini" />;
  }

  return (
    <ApexChart type="bar" series={series} options={options} height={300} />
  );
}

export function TopExpenseChart({
  rows,
}: {
  rows: AccountingDashboard["top_expense_accounts"];
}) {
  const brandPrimary = useBrandPrimary();

  const options = useMemo<ApexOptions>(
    () => ({
      ...baseOptions,
      chart: { ...baseOptions.chart, type: "bar" },
      colors: [brandPrimary],
      plotOptions: {
        bar: {
          borderRadius: 5,
          barHeight: "62%",
          horizontal: true,
        },
      },
      xaxis: {
        categories: rows.map((r) =>
          r.name.length > 22 ? `${r.name.slice(0, 22)}…` : r.name,
        ),
        labels: { style: { colors: "#94a3b8", fontSize: "11px" } },
      },
      yaxis: {
        labels: { style: { colors: "#64748b", fontSize: "11px" } },
      },
      tooltip: {
        ...baseOptions.tooltip,
        y: { formatter: (v) => formatLedgerAmount(v) },
      },
    }),
    [rows, brandPrimary],
  );

  const series = useMemo(
    () => [{ name: "Beban", data: rows.map((r) => r.balance) }],
    [rows],
  );

  if (rows.length === 0) {
    return <ChartEmpty message="Belum ada beban di periode ini" />;
  }

  return (
    <ApexChart type="bar" series={series} options={options} height={300} />
  );
}
