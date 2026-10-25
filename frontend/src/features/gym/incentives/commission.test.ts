import { describe, expect, it } from "vitest";
import { formatPercent, incidentLabel, initialSchemeForm, parsePercent, toSchemeInput, type CommissionSettings } from "./commission";

const defaults: CommissionSettings = {
  classPoolPercent: 10,
  ptPoolPercent: 40,
  shareHeadCoachPercent: 20,
  shareCoachPercent: 16,
  shareAssistantPercent: 8,
  deductionPercents: { no_show: 15, short_notice_leave: 5, late: 5 },
  maxDeductionPercent: 50,
  payoutChannel: "payroll",
};

describe("parsePercent", () => {
  it("reads 0 to 100 with a comma or a dot", () => {
    expect(parsePercent("12,5")).toBe(12.5);
    expect(parsePercent(" 40 ")).toBe(40);
    expect(parsePercent("0")).toBe(0);
    expect(parsePercent("")).toBeNull();
    expect(parsePercent("101")).toBeNull();
    expect(parsePercent("-1")).toBeNull();
    expect(parsePercent("abc")).toBeNull();
  });
});

describe("scheme form", () => {
  it("starts a branch scheme from the defaults", () => {
    const form = initialSchemeForm(null, defaults);
    expect(form.class_pool_percent).toBe("10");
    expect(form.deductions).toEqual({ no_show: "15", short_notice_leave: "5", late: "5" });
    expect(toSchemeInput({ ...form, name: "Bagi hasil" }, undefined, false)).toBe("Pilih cabang untuk skema ini.");
    expect(toSchemeInput({ ...form, name: "Bagi hasil", branch_id: "b1" }, undefined, false)).toEqual({
      branch_id: "b1",
      name: "Bagi hasil",
      class_pool_percent: 10,
      pt_pool_percent: 40,
      share_head_coach_percent: 20,
      share_coach_percent: 16,
      share_assistant_percent: 8,
      max_deduction_percent: 50,
      deduction_percents: { no_show: 15, short_notice_leave: 5, late: 5 },
      payout_channel: "payroll",
      is_active: true,
    });
  });

  it("keeps the default scheme branchless and refuses bad numbers", () => {
    const scheme = {
      ...defaults,
      id: "s1",
      branchId: null,
      branchName: null,
      name: "Default",
      isActive: false,
      updatedAt: "2026-10-28T00:00:00.000Z",
      deductionPercents: { no_show: 10, absent_training: 3 },
    };
    const form = initialSchemeForm(scheme, defaults);
    // The defaults' kinds show up with 0 when the scheme has none for them.
    expect(form.deductions).toEqual({ no_show: "10", short_notice_leave: "0", late: "0", absent_training: "3" });
    const input = toSchemeInput(form, "s1", true);
    expect(typeof input === "object" && input.branch_id === null && input.id === "s1" && input.is_active === false).toBe(true);
    expect(toSchemeInput({ ...form, share_coach_percent: "120" }, "s1", true)).toBe("Persentase harus 0 sampai 100.");
    expect(toSchemeInput({ ...form, deductions: { late: "x" } }, "s1", true)).toBe("Potongan Terlambat harus 0 sampai 100.");
    expect(toSchemeInput({ ...form, name: " A " }, "s1", true)).toBe("Nama skema minimal 2 huruf.");
  });
});

describe("labels", () => {
  it("names incident kinds and formats percents", () => {
    expect(incidentLabel("no_show")).toBe("Tidak hadir tanpa kabar");
    expect(incidentLabel("absent_training")).toBe("absent training");
    expect(formatPercent(12.5)).toBe("12,5%");
  });
});
