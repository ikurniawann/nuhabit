import { describe, expect, it } from "vitest";
import { brandComparison, overviewKpis, sourceConversion } from "@/lib/dashboard/recruitment";
import {
  EMPTY_ANALYTICS_VIEW,
  analyticsCsv,
  buildAnalyticsView,
  type AnalyticsOverviewResponse,
} from "./analytics-view";

const candidates = [
  { id: "1", status: "hired", created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-11T00:00:00Z", position_id: "p1" },
  { id: "2", status: "applied", created_at: "2026-09-02T00:00:00Z", updated_at: "2026-09-02T00:00:00Z", position_id: "p1" },
  { id: "3", status: "archived", created_at: "2026-09-03T00:00:00Z", updated_at: "2026-09-03T00:00:00Z", position_id: null },
  { id: "4", status: "screening", created_at: "2026-09-04T00:00:00Z", updated_at: "2026-09-04T00:00:00Z", position_id: null },
];

const overview: AnalyticsOverviewResponse = {
  ...overviewKpis(candidates).kpis,
  hard_to_fill: [{ position_id: "p1", position_title: "Barista", count: 1 }],
};
const sources = {
  data: sourceConversion([
    { source: "portal", status: "hired" },
    { source: "portal", status: "applied" },
  ]),
};
const brands = brandComparison(
  [{ id: "b1", name: "Kopi Satu" }],
  [{ brand_id: "b1", status: "hired" }],
  null
);

describe("buildAnalyticsView", () => {
  const view = buildAnalyticsView(overview, sources, brands, new Date(2026, 9, 31));

  it("hiring rate diambil dari tahap Hired, bukan tahap terakhir", () => {
    expect(view.hiringRate).toBe(25);
    expect(view.conversionRates.at(-1)).toEqual({ stage: "Archived", rate: 25 });
    expect(view.timeToHire).toEqual({ avgDays: 10, count: 1 });
  });

  it("tren 6 bulan berakhir di bulan berjalan, tanpa bulan ganda di tanggal 31", () => {
    expect(view.monthlyTrend.map((m) => m.month)).toEqual([
      "Mei 26", "Jun 26", "Jul 26", "Agu 26", "Sep 26", "Okt 26",
    ]);
    expect(view.monthlyTrend[0]).toMatchObject({ applied: 1, hired: 0 });
  });

  it("meneruskan sumber, posisi sulit, dan brand", () => {
    expect(view.topSources).toEqual([{ source: "Website Portal", total: 2, hired: 1, rate: 50 }]);
    expect(view.hardToFill).toHaveLength(1);
    expect(view.hiredByBrand).toEqual([{ name: "Kopi Satu", value: 1 }]);
  });

  it("time to hire 0 bila belum ada yang hired", () => {
    const empty = buildAnalyticsView(
      { ...overviewKpis([]).kpis, hard_to_fill: [] },
      { data: [] },
      { barData: [], pieData: [] },
      new Date(2026, 0, 15)
    );
    expect(empty.timeToHire).toEqual({ avgDays: 0, count: 0 });
    expect(empty.hiringRate).toBe(0);
  });
});

describe("analyticsCsv", () => {
  it("bagian sumber, posisi, dan brand", () => {
    const csv = analyticsCsv(buildAnalyticsView(overview, sources, brands, new Date(2026, 9, 4)));
    expect(csv.split("\n").slice(0, 2)).toEqual(['"Metrik","Nilai"', '"Rata-rata Time to Hire (hari)","10"']);
    expect(csv).toContain('"Website Portal","1 hired / 2 applied (50%)"');
    expect(csv).toContain('"Barista","1 kandidat di pipeline"');
    expect(csv).toContain('"Kopi Satu","Applied: 1, Hired: 1, Active: 0"');
  });

  it("view kosong tetap punya header", () => {
    expect(analyticsCsv(EMPTY_ANALYTICS_VIEW).startsWith('"Metrik","Nilai"')).toBe(true);
  });
});
