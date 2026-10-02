import { describe, expect, it } from "vitest";
import { computeCommission, DEFAULT_COMMISSION_SETTINGS, isValidPeriod, periodLabel, shareFor, shiftPeriod } from "./commission";

const team = [
  { id: "hc", level: "head_coach" as const, commission_share_percent: null },
  ...["c1", "c2", "c3", "c4", "c5"].map((id) => ({ id, level: "coach" as const, commission_share_percent: null })),
];

describe("computeCommission (skema Excel owner)", () => {
  it("pool = 10% kelas + 40% Personal Training, dibagi Head Coach 20% + 5 × Coach 16% = 100%", () => {
    const r = computeCommission({ classRevenue: 50_000_000, ptRevenue: 10_000_000, settings: DEFAULT_COMMISSION_SETTINGS, coaches: team });
    expect(r.class_pool).toBe(5_000_000);
    expect(r.pt_pool).toBe(4_000_000);
    expect(r.total_pool).toBe(9_000_000);
    expect(r.allocated_percent).toBe(100);
    expect(r.lines.find((l) => l.coach_id === "hc")?.amount).toBe(1_800_000);
    expect(r.lines.find((l) => l.coach_id === "c1")?.amount).toBe(1_440_000);
    expect(r.retained_amount).toBe(0);
    expect(r.over_allocated).toBe(false);
  });

  it("opsi B: coach lebih sedikit → sisa pool jadi revenue perusahaan", () => {
    const r = computeCommission({ classRevenue: 10_000_000, ptRevenue: 0, settings: DEFAULT_COMMISSION_SETTINGS, coaches: team.slice(0, 4) });
    expect(r.allocated_percent).toBe(68);
    expect(r.allocated_amount).toBe(680_000);
    expect(r.retained_amount).toBe(320_000);
  });

  it("opsi B: total > 100% ditandai (approve diblokir)", () => {
    const seven = [...team, { id: "c6", level: "coach" as const, commission_share_percent: null }];
    expect(computeCommission({ classRevenue: 1_000_000, ptRevenue: 0, settings: DEFAULT_COMMISSION_SETTINGS, coaches: seven }).over_allocated).toBe(true);
  });

  it("override persentase per coach dan pembulatan sen", () => {
    expect(shareFor({ id: "x", level: "coach", commission_share_percent: 10 }, DEFAULT_COMMISSION_SETTINGS)).toBe(10);
    const r = computeCommission({ classRevenue: 333_333, ptRevenue: 0, settings: DEFAULT_COMMISSION_SETTINGS, coaches: [team[1]] });
    expect(r.total_pool).toBe(33_333.3);
    expect(r.lines[0].amount).toBe(5_333.33);
  });

  it("tanpa revenue → semua nol", () => {
    const r = computeCommission({ classRevenue: 0, ptRevenue: 0, settings: DEFAULT_COMMISSION_SETTINGS, coaches: team });
    expect(r.total_pool).toBe(0);
    expect(r.lines.every((l) => l.amount === 0)).toBe(true);
  });
});

describe("periode", () => {
  it("validasi, label, dan geser bulan", () => {
    expect(isValidPeriod("2026-10")).toBe(true);
    expect(isValidPeriod("2026-13")).toBe(false);
    expect(periodLabel("2026-10")).toBe("Oktober 2026");
    expect(shiftPeriod("2026-01", -1)).toBe("2025-12");
  });
});
