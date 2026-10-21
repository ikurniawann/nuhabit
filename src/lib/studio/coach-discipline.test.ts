import { describe, expect, it } from "vitest";
import { applyDeduction, DEFAULT_DISCIPLINE_RULES, monthDeductionPercent, normalizeDisciplineRules, warningProposal } from "./coach-discipline";

describe("aturan disiplin", () => {
  it("default & nilai rusak dibatasi", () => {
    expect(normalizeDisciplineRules(null)).toEqual(DEFAULT_DISCIPLINE_RULES);
    const r = normalizeDisciplineRules({ deduction_percent: { no_show: 120, late: 2.5 }, max_deduction_percent: -5, warning_threshold: 0, warning_window_days: 30 });
    expect(r.deduction_percent).toEqual({ no_show: 100, short_notice_leave: 5, late: 5 });
    expect(r.max_deduction_percent).toBe(0);
    expect(r.warning_threshold).toBe(1);
    expect(r.warning_window_days).toBe(30);
  });
});

describe("potongan komisi", () => {
  it("jumlah persen kejadian, dibatasi maksimum", () => {
    expect(monthDeductionPercent([{ deduction_percent: 15 }, { deduction_percent: 5 }], 50)).toBe(20);
    expect(monthDeductionPercent([{ deduction_percent: 30 }, { deduction_percent: 30 }], 50)).toBe(50);
    expect(monthDeductionPercent([], 50)).toBe(0);
  });

  it("kotor → potongan → bersih, dalam sen", () => {
    expect(applyDeduction(1_234_567.89, 20)).toEqual({ gross_amount: 1_234_567.89, deduction_percent: 20, deduction_amount: 246_913.58, amount: 987_654.31 });
    expect(applyDeduction(500_000, 0)).toEqual({ gross_amount: 500_000, deduction_percent: 0, deduction_amount: 0, amount: 500_000 });
  });
});

describe("usulan SP", () => {
  const inc = (id: string) => ({ id, occurred_on: "2026-10-01" });

  it("ambang tercapai → SP berikutnya dengan kejadian yang belum tercakup", () => {
    expect(warningProposal({ incidents: [inc("a"), inc("b"), inc("c")], coveredIncidentIds: new Set(), lastIssuedLevel: 0, hasOpenProposal: false, threshold: 3 })).toEqual({
      level: 1,
      incident_ids: ["a", "b", "c"],
    });
    expect(warningProposal({ incidents: [inc("a"), inc("b"), inc("c"), inc("d")], coveredIncidentIds: new Set(["a", "b", "c"]), lastIssuedLevel: 1, hasOpenProposal: false, threshold: 3 })).toBeNull();
  });

  it("maksimal SP3; tidak dobel bila masih ada usulan terbuka", () => {
    expect(warningProposal({ incidents: [inc("x"), inc("y")], coveredIncidentIds: new Set(), lastIssuedLevel: 3, hasOpenProposal: false, threshold: 2 })?.level).toBe(3);
    expect(warningProposal({ incidents: [inc("x"), inc("y")], coveredIncidentIds: new Set(), lastIssuedLevel: 0, hasOpenProposal: true, threshold: 2 })).toBeNull();
  });
});
