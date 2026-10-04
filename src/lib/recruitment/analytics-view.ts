/**
 * Data halaman Analytics rekrutmen: gabungan respons /api/analytics/{overview,
 * sources,brands} menjadi satu view, plus ekspor CSV-nya. Murni, tanpa fetch.
 */

import type {
  brandComparison,
  hardToFill,
  overviewKpis,
  sourceConversion,
} from "@/lib/dashboard/recruitment";
import { toCsv } from "./candidate-csv";

export type AnalyticsOverviewResponse = ReturnType<typeof overviewKpis>["kpis"] & {
  hard_to_fill: ReturnType<typeof hardToFill>;
};
export type AnalyticsSourcesResponse = { data: ReturnType<typeof sourceConversion> };
export type AnalyticsBrandsResponse = ReturnType<typeof brandComparison>;

export interface AnalyticsView {
  timeToHire: { avgDays: number; count: number };
  /** Persentase kandidat berstatus hired dari semua pelamar periode ini. */
  hiringRate: number;
  conversionRates: AnalyticsOverviewResponse["conversion_rates"];
  topSources: AnalyticsSourcesResponse["data"];
  hardToFill: AnalyticsOverviewResponse["hard_to_fill"];
  brandComparison: AnalyticsBrandsResponse["barData"];
  monthlyTrend: Array<{ month: string; applied: number; hired: number }>;
  hiredByBrand: AnalyticsBrandsResponse["pieData"];
}

export const EMPTY_ANALYTICS_VIEW: AnalyticsView = {
  timeToHire: { avgDays: 0, count: 0 },
  hiringRate: 0,
  conversionRates: [],
  topSources: [],
  hardToFill: [],
  brandComparison: [],
  monthlyTrend: [],
  hiredByBrand: [],
};

/**
 * Tren 6 bulan terakhir. API belum punya data per bulan, jadi total periode
 * dibagi rata ke 6 bulan. Label sumbu "Okt 26".
 */
function monthlyTrend(overview: AnalyticsOverviewResponse, now: Date) {
  return Array.from({ length: 6 }, (_, i) => ({
    month: new Date(now.getFullYear(), now.getMonth() - (5 - i), 1).toLocaleDateString("id-ID", {
      month: "short",
      year: "2-digit",
    }),
    applied: Math.round(overview.total_applicants / 6),
    hired: Math.round(overview.total_hired / 6),
  }));
}

export function buildAnalyticsView(
  overview: AnalyticsOverviewResponse,
  sources: AnalyticsSourcesResponse,
  brands: AnalyticsBrandsResponse,
  now: Date
): AnalyticsView {
  return {
    timeToHire: { avgDays: overview.time_to_hire_avg ?? 0, count: overview.total_hired },
    hiringRate: overview.conversion_rates.find((c) => c.stage === "Hired")?.rate ?? 0,
    conversionRates: overview.conversion_rates,
    topSources: sources.data,
    hardToFill: overview.hard_to_fill,
    brandComparison: brands.barData,
    monthlyTrend: monthlyTrend(overview, now),
    hiredByBrand: brands.pieData,
  };
}

export const analyticsCsv = (view: AnalyticsView) =>
  toCsv([
    ["Metrik", "Nilai"],
    ["Rata-rata Time to Hire (hari)", view.timeToHire.avgDays],
    ["\nSumber Kandidat"],
    ...view.topSources.map((s) => [s.source, `${s.hired} hired / ${s.total} applied (${s.rate}%)`]),
    ["\nPosisi Sulit Diisi"],
    ...view.hardToFill.map((h) => [h.position_title, `${h.count} kandidat di pipeline`]),
    ["\nPerbandingan Brand"],
    ...view.brandComparison.map((b) => [
      b.brand,
      `Applied: ${b.applicants}, Hired: ${b.hired}, Active: ${b.active}`,
    ]),
  ]);
