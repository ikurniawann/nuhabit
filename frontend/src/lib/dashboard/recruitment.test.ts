import { describe, expect, it } from "vitest";
import {
  attentionItem,
  brandComparison,
  funnelStages,
  hardToFill,
  lastEightWeeks,
  overviewKpis,
  periodStartByCalendar,
  periodStartByDays,
  sourceConversion,
  sourceDistribution,
  weeklyApplications,
} from "./recruitment";

const NOW = new Date("2026-10-04T05:00:00Z");

describe("periode", () => {
  it("hari tetap dengan fallback", () => {
    expect(periodStartByDays("week", NOW, 30).toISOString()).toBe("2026-09-27T05:00:00.000Z");
    expect(periodStartByDays("lain", NOW, 90).toISOString()).toBe("2026-07-06T05:00:00.000Z");
  });

  it("bulan kalender, default 3 bulan", () => {
    expect(periodStartByCalendar("month", NOW).getMonth()).toBe(8);
    expect(periodStartByCalendar("x", NOW).getMonth()).toBe(6);
    expect(periodStartByCalendar("week", NOW).toISOString()).toBe("2026-09-27T05:00:00.000Z");
  });
});

describe("sumber kandidat", () => {
  const rows = [
    { source: "portal", status: "hired" },
    { source: "portal", status: "applied" },
    { source: "referral", status: "hired" },
    { source: "tiktok", status: "applied" },
    { source: null, status: "applied" },
  ];

  it("distribusi berlabel, sumber tak dikenal tetap tampil apa adanya", () => {
    expect(sourceDistribution(rows)).toEqual([
      { name: "Website Portal", value: 2 },
      { name: "Referral", value: 1 },
      { name: "tiktok", value: 1 },
    ]);
  });

  it("konversi hanya sumber dikenal, rate 1 desimal", () => {
    expect(sourceConversion(rows)).toEqual([
      { source: "Website Portal", total: 2, hired: 1, rate: 50 },
      { source: "Referral", total: 1, hired: 1, rate: 100 },
    ]);
  });
});

describe("brandComparison", () => {
  it("hitung per brand aktif; brand tanpa pelamar disembunyikan", () => {
    const brands = [
      { id: "b1", name: "Kopi" },
      { id: "b2", name: "Roti" },
    ];
    const rows = [
      { brand_id: "b1", status: "hired" },
      { brand_id: "b1", status: "talent_pool" },
      { brand_id: "b1", status: "rejected" },
      { brand_id: "b9", status: "applied" },
    ];
    expect(brandComparison(brands, rows, null)).toEqual({
      barData: [{ brand: "Kopi", applicants: 3, active: 1, hired: 1, in_pool: 1 }],
      pieData: [{ name: "Kopi", value: 1 }],
    });
    expect(brandComparison(brands, rows, "b2").barData).toEqual([]);
  });
});

describe("funnel & overview", () => {
  it("funnelStages mengabaikan status di luar tahap", () => {
    const stages = funnelStages([{ status: "applied" }, { status: "applied" }, { status: "rejected" }]);
    expect(stages[0]).toEqual({ stage: "Applied", count: 2 });
    expect(stages).toHaveLength(7);
  });

  it("overviewKpis + hardToFill", () => {
    const candidates = [
      { id: "1", status: "hired", created_at: "2026-09-01", updated_at: "2026-09-11", position_id: "p1" },
      { id: "2", status: "applied", created_at: "2026-09-01", updated_at: "2026-09-01", position_id: "p1" },
      { id: "3", status: "interview", created_at: "2026-09-01", updated_at: "2026-09-01", position_id: "p2" },
      { id: "4", status: "rejected", created_at: "2026-09-01", updated_at: "2026-09-01", position_id: "p2" },
    ];
    const { kpis, activePerPosition } = overviewKpis(candidates);
    expect(kpis).toMatchObject({
      time_to_hire_avg: 10,
      hiring_rate: 25,
      total_applicants: 4,
      total_hired: 1,
      total_rejected: 1,
      total_active: 2,
    });
    expect(kpis.conversion_rates.find((r) => r.stage === "Tolak")?.rate).toBe(25);
    expect(hardToFill(activePerPosition, [{ id: "p1", title: "Barista" }])).toEqual([
      { position_id: "p1", position_title: "Barista", count: 1 },
      { position_id: "p2", position_title: "Unknown", count: 1 },
    ]);
    expect(overviewKpis([]).kpis.time_to_hire_avg).toBeNull();
  });
});

describe("mingguan", () => {
  it("8 minggu berakhir Minggu, terlama dulu", () => {
    const weeks = lastEightWeeks(new Date(2026, 9, 7)); // Rabu
    expect(weeks).toHaveLength(8);
    expect(weeks[7].end.getDay()).toBe(0);
    expect(weeks[7].start.getDay()).toBe(1);
    const counts = weeklyApplications(weeks, [{ created_at: weeks[7].start.toISOString() }]);
    expect(counts[7]).toMatchObject({ week: "Week 8", count: 1 });
  });
});

describe("attentionItem", () => {
  it("merah setelah 14 hari", () => {
    const base = { id: "c", full_name: "A", status: "screening", positions: null, brands: { name: "Kopi" } };
    expect(attentionItem({ ...base, updated_at: "2026-09-15T05:00:00Z" }, NOW.getTime())).toMatchObject({
      days_in_current_status: 19,
      urgency: "red",
      brand_name: "Kopi",
      position_title: null,
    });
    expect(attentionItem({ ...base, updated_at: "2026-09-25T05:00:00Z" }, NOW.getTime()).urgency).toBe("amber");
  });
});
