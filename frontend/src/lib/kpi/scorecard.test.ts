import { describe, expect, it } from "vitest";
import { composeScore } from "@/lib/kpi/scorecard";

describe("composeScore", () => {
  it("all components meet target → score 100", () => {
    const result = composeScore([
      { code: "a", weight: 60, attainment: 1 },
      { code: "b", weight: 40, attainment: 1 },
    ]);
    expect(result.score).toBe(100);
    expect(result.excluded).toEqual([]);
  });

  it("weighted mix computes correctly", () => {
    // 50×0.8 + 50×0.6 = 70
    const result = composeScore([
      { code: "a", weight: 50, attainment: 0.8 },
      { code: "b", weight: 50, attainment: 0.6 },
    ]);
    expect(result.score).toBe(70);
  });

  it("over-achievement can offset but final score capped at 100", () => {
    // 50×1.2 + 50×0.9 = 105 → cap 100
    const result = composeScore([
      { code: "a", weight: 50, attainment: 1.2 },
      { code: "b", weight: 50, attainment: 0.9 },
    ]);
    expect(result.score).toBe(100);
    // raw tetap tersedia utk audit
    expect(result.rawScore).toBe(105);
  });

  it("null attainment redistributes weight proportionally (aturan minimum data)", () => {
    // b dikeluarkan; a & c tersisa 50+25=75 → a efektif 66.67, c 33.33
    // skor = 66.67×0.9 + 33.33×0.6 = 80
    const result = composeScore([
      { code: "a", weight: 50, attainment: 0.9 },
      { code: "b", weight: 25, attainment: null },
      { code: "c", weight: 25, attainment: 0.6 },
    ]);
    expect(result.excluded).toEqual(["b"]);
    expect(result.score).toBe(80);
    const a = result.breakdown.find((x) => x.code === "a")!;
    expect(a.effectiveWeight).toBeCloseTo(66.67, 1);
  });

  it("all excluded → score null", () => {
    const result = composeScore([
      { code: "a", weight: 100, attainment: null },
    ]);
    expect(result.score).toBeNull();
    expect(result.excluded).toEqual(["a"]);
  });

  it("empty components → score null", () => {
    expect(composeScore([]).score).toBeNull();
  });

  it("zero-weight components contribute nothing, stay in breakdown, and are reported excluded", () => {
    const result = composeScore([
      { code: "a", weight: 100, attainment: 0.5 },
      { code: "b", weight: 0, attainment: 1 },
    ]);
    expect(result.score).toBe(50);
    expect(result.breakdown).toHaveLength(2);
    expect(result.excluded).toEqual(["b"]);
  });

  it("score dibulatkan 2 desimal", () => {
    const result = composeScore([
      { code: "a", weight: 33, attainment: 1 },
      { code: "b", weight: 33, attainment: 1 },
      { code: "c", weight: 34, attainment: 0.5 },
    ]);
    expect(result.score).toBe(83);
  });
});
