import { describe, expect, it } from "vitest";
import { safeRatio } from "@/lib/kpi/collect-math";

describe("safeRatio", () => {
  it("computes normal ratio", () => {
    expect(safeRatio(45, 50)).toBe(0.9);
  });

  it("zero/negative/invalid denominator → null (data tidak cukup)", () => {
    expect(safeRatio(5, 0)).toBeNull();
    expect(safeRatio(5, -1)).toBeNull();
    expect(safeRatio(5, NaN)).toBeNull();
  });

  it("invalid numerator → null", () => {
    expect(safeRatio(NaN, 10)).toBeNull();
  });

  it("negative numerator clamps to 0 (rasio tak boleh negatif)", () => {
    expect(safeRatio(-3, 10)).toBe(0);
  });

  it("ratio can exceed 1 (mis. selisih kas > setoran) — attainment yang menilai", () => {
    expect(safeRatio(15, 10)).toBe(1.5);
  });
});
