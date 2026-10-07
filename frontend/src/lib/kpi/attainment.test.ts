import { describe, expect, it } from "vitest";
import { ATTAINMENT_CAP, computeAttainment } from "@/lib/kpi/attainment";

describe("computeAttainment — higher_better", () => {
  it("meets target exactly → 1.0", () => {
    expect(
      computeAttainment({ direction: "higher_better", actual: 100, target: 100 })
    ).toBe(1);
  });

  it("half of target → 0.5", () => {
    expect(
      computeAttainment({ direction: "higher_better", actual: 50, target: 100 })
    ).toBe(0.5);
  });

  it("over-achievement capped at 120%", () => {
    expect(
      computeAttainment({ direction: "higher_better", actual: 500, target: 100 })
    ).toBe(ATTAINMENT_CAP);
  });

  it("negative actual clamps to 0", () => {
    expect(
      computeAttainment({ direction: "higher_better", actual: -5, target: 100 })
    ).toBe(0);
  });

  it("invalid target (0 or negative) → null (excluded)", () => {
    expect(
      computeAttainment({ direction: "higher_better", actual: 10, target: 0 })
    ).toBeNull();
    expect(
      computeAttainment({ direction: "higher_better", actual: 10, target: -1 })
    ).toBeNull();
  });
});

describe("computeAttainment — lower_better", () => {
  it("meets target exactly → 1.0", () => {
    expect(
      computeAttainment({ direction: "lower_better", actual: 5, target: 5 })
    ).toBe(1);
  });

  it("better than target (lower) capped at 120%", () => {
    // target 10 menit telat, aktual 1 menit → 10/1 = 10 → cap 1.2
    expect(
      computeAttainment({ direction: "lower_better", actual: 1, target: 10 })
    ).toBe(ATTAINMENT_CAP);
  });

  it("worse than target → proportional below 1", () => {
    expect(
      computeAttainment({ direction: "lower_better", actual: 20, target: 10 })
    ).toBe(0.5);
  });

  it("actual 0 (sempurna) → cap", () => {
    expect(
      computeAttainment({ direction: "lower_better", actual: 0, target: 10 })
    ).toBe(ATTAINMENT_CAP);
  });

  it("target 0: actual 0 → 1.0, actual > 0 → 0", () => {
    expect(
      computeAttainment({ direction: "lower_better", actual: 0, target: 0 })
    ).toBe(1);
    expect(
      computeAttainment({ direction: "lower_better", actual: 3, target: 0 })
    ).toBe(0);
  });

  it("negative target → null", () => {
    expect(
      computeAttainment({ direction: "lower_better", actual: 3, target: -1 })
    ).toBeNull();
  });
});

describe("computeAttainment — boolean", () => {
  it("truthy (>=1) → 1.0, else 0 (tanpa bonus cap)", () => {
    expect(computeAttainment({ direction: "boolean", actual: 1, target: 1 })).toBe(1);
    expect(computeAttainment({ direction: "boolean", actual: 0, target: 1 })).toBe(0);
  });
});

describe("computeAttainment — data absen", () => {
  it("actual null/undefined → null (indikator dikeluarkan)", () => {
    expect(
      computeAttainment({ direction: "higher_better", actual: null, target: 100 })
    ).toBeNull();
    expect(
      computeAttainment({ direction: "lower_better", actual: undefined, target: 10 })
    ).toBeNull();
  });

  it("nilai non-finite → null", () => {
    expect(
      computeAttainment({ direction: "higher_better", actual: NaN, target: 100 })
    ).toBeNull();
  });
});
