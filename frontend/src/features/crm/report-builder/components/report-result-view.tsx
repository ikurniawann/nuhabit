"use client";

import { useMemo } from "react";
import type { ApexOptions } from "apexcharts";
import { ApexChart } from "@/features/pos/reports/components/apex-chart";
import { formatCellValue } from "@/lib/crm/report-builder";
import { formatNumber, formatRupiah, formatRupiahCompact } from "@/lib/format";
import type { ChartType, ReportResult } from "../types";

const PALETTE = ["#9F1239", "#BE185D", "#DB2777", "#F472B6", "#FBCFE8", "#7C2D12", "#B45309", "#047857"];

function labelOf(result: ReportResult, row: Record<string, unknown>): string {
  const col = result.columns.find((c) => !c.isAggregate);
  if (!col) return "—";
  return formatCellValue(col.type, row[col.key]);
}

/** Tabel hasil report — dipakai untuk chart_type "table" dan sebagai fallback. */
export function ReportTable({ result, maxRows }: { result: ReportResult; maxRows?: number }) {
  const rows = maxRows ? result.rows.slice(0, maxRows) : result.rows;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200/70 bg-gray-50/80 text-xs uppercase tracking-wide text-gray-500">
            {result.columns.map((c) => (
              <th key={c.key} className={`px-4 py-3 font-semibold ${c.isAggregate || c.type === "number" || c.type === "currency" ? "text-right" : "text-left"}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200/50">
          {rows.map((row, i) => (
            <tr key={i} className="hover:bg-gray-50/80">
              {result.columns.map((c) => (
                <td key={c.key} className={`px-4 py-2.5 ${c.isAggregate || c.type === "number" || c.type === "currency" ? "text-right tabular-nums" : "text-left"} ${c.isAggregate ? "font-medium text-gray-900" : "text-gray-700"}`}>
                  {formatCellValue(c.type, row[c.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {maxRows && result.rows.length > maxRows ? (
        <p className="px-4 py-2 text-xs text-gray-500">Menampilkan {maxRows} dari {result.rows.length} baris.</p>
      ) : null}
    </div>
  );
}

/** Kartu satu angka: nilai agregat pertama dari baris pertama. */
export function ReportKpi({ result }: { result: ReportResult }) {
  // Utamakan kolom rupiah: kartu angka biasanya dipakai untuk nilai, bukan cacah.
  const col =
    result.columns.find((c) => c.isAggregate && c.type === "currency") ??
    result.columns.find((c) => c.isAggregate) ??
    result.columns[0];
  const total = useMemo(() => {
    if (!col) return null;
    if (!col.isAggregate) return result.row_count;
    return result.rows.reduce((sum, r) => sum + (Number(r[col.key]) || 0), 0);
  }, [col, result]);
  if (!col) return <p className="py-6 text-center text-sm text-gray-500">Tidak ada data.</p>;
  return (
    <div className="px-5 py-6">
      <p className="text-xs uppercase tracking-wide text-gray-500">{col.label}</p>
      <p className="mt-1 text-3xl font-bold text-gray-900">
        {col.isAggregate ? formatCellValue(col.type, total) : formatNumber(result.row_count)}
      </p>
      <p className="mt-1 text-xs text-gray-500">{result.row_count} baris</p>
    </div>
  );
}

/** Grafik hasil report. Kategori = kolom non-agregat pertama, seri = kolom agregat. */
export function ReportChart({ result, chartType, height = 320 }: { result: ReportResult; chartType: ChartType; height?: number }) {
  const { series, options, usable } = useMemo(() => {
    const aggCols = result.columns.filter((c) => c.isAggregate);
    const categories = result.rows.map((r) => labelOf(result, r));
    if (aggCols.length === 0 || result.rows.length === 0) {
      return { series: [], options: {} as ApexOptions, usable: false };
    }
    const isPie = chartType === "pie" || chartType === "donut";
    const money = aggCols[0].type === "currency";
    // `labels` hanya boleh ada untuk pie/donut. Mengisinya dengan undefined
    // membuat ApexCharts membaca undefined.length dan grafik gagal digambar.
    const base: ApexOptions = {
      chart: { toolbar: { show: false }, fontFamily: "inherit", animations: { enabled: false } },
      colors: PALETTE,
      ...(isPie ? { labels: categories } : {}),
      legend: { position: "bottom" },
      dataLabels: { enabled: isPie },
      tooltip: {
        y: { formatter: (v: number) => (money ? formatRupiah(v) : formatNumber(v, 3)) },
      },
    };
    if (isPie) {
      return {
        series: result.rows.map((r) => Number(r[aggCols[0].key]) || 0),
        options: base,
        usable: true,
      };
    }
    // Rupiah dan jumlah baris beda ordo besaran. Bila keduanya ada dalam satu
    // grafik, seri jumlah jadi tak terlihat — jadi diberi sumbu Y sendiri.
    // Sumbu cacah: tanpa ini ApexCharts membuat tik pecahan (0,2 / 0,4) yang
    // setelah dibulatkan tampil sebagai label kembar "0 0 0 1 1 1".
    const maxOf = (cols: typeof aggCols) =>
      Math.max(1, ...cols.flatMap((c) => result.rows.map((r) => Number(r[c.key]) || 0)));
    const intTicks = (cols: typeof aggCols) => {
      const max = Math.ceil(maxOf(cols));
      return max <= 10 ? { tickAmount: max, min: 0, max } : {};
    };
    const hasMoney = aggCols.some((c) => c.type === "currency");
    const hasOther = aggCols.some((c) => c.type !== "currency");
    const dualAxis = hasMoney && hasOther;
    let moneyShown = false;
    let otherShown = false;
    // Pada batang horizontal, sumbu nilai adalah X dan kategori ada di Y.
    // Memasang formatter angka di yaxis membuat label kategori jadi NaN.
    const horizontal = chartType === "bar";
    const yaxis = horizontal
      ? { labels: { style: { fontSize: "11px" } } }
      : dualAxis
      ? aggCols.map((c) => {
          const isMoney = c.type === "currency";
          const firstOfGroup = isMoney ? !moneyShown : !otherShown;
          if (isMoney) moneyShown = true;
          else otherShown = true;
          return {
            seriesName: c.label,
            opposite: !isMoney,
            show: firstOfGroup,
            ...(isMoney ? {} : intTicks(aggCols.filter((x) => x.type !== "currency"))),
            labels: { formatter: (v: number) => (isMoney ? formatRupiahCompact(v) : formatNumber(v)) },
            title: firstOfGroup ? { text: isMoney ? "Rupiah" : "Jumlah", style: { fontSize: "11px", fontWeight: 500 } } : undefined,
          };
        })
      : { ...(money ? {} : intTicks(aggCols)), labels: { formatter: (v: number) => (money ? formatRupiahCompact(v) : formatNumber(v)) } };
    return {
      series: aggCols.map((c) => ({ name: c.label, data: result.rows.map((r) => Number(r[c.key]) || 0) })),
      options: {
        ...base,
        xaxis: horizontal
          ? { categories, ...(money ? {} : intTicks(aggCols)), labels: { formatter: (v: string) => (money ? formatRupiahCompact(Number(v)) : formatNumber(Number(v))), style: { fontSize: "11px" } } }
          : { categories, labels: { rotate: -35, trim: true, style: { fontSize: "11px" } } },
        yaxis,
        plotOptions: { bar: { horizontal: chartType === "bar", borderRadius: 4, columnWidth: "55%" } },
        stroke: chartType === "line" || chartType === "area" ? { curve: "smooth", width: 2 } : { width: 0 },
      } as ApexOptions,
      usable: true,
    };
  }, [result, chartType]);

  if (!usable) {
    return <p className="py-10 text-center text-sm text-gray-500">Grafik butuh minimal satu kolom agregasi. Tambahkan Group by lalu pilih agregasi.</p>;
  }
  const apexType = chartType === "bar" || chartType === "column" ? "bar" : chartType;
  return <ApexChart type={apexType as "bar" | "line" | "area" | "pie" | "donut"} series={series as ApexOptions["series"]} options={options} height={height} />;
}

/** Pemilih tampilan berdasarkan chart_type report. */
export function ReportResultView({ result, chartType, height, maxRows }: { result: ReportResult; chartType: ChartType; height?: number; maxRows?: number }) {
  if (result.rows.length === 0) {
    return <p className="py-12 text-center text-sm text-gray-500">Tidak ada data untuk filter ini.</p>;
  }
  if (chartType === "table") return <ReportTable result={result} maxRows={maxRows} />;
  return <ReportChart result={result} chartType={chartType} height={height} />;
}
