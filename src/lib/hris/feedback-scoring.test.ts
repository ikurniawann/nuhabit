import { describe, expect, it } from "vitest";
import { computeFinalScore, finalGrade } from "./feedback-scoring";

describe("finalGrade", () => {
  it.each([
    [95, "A"],
    [90, "A"],
    [85, "B"],
    [70, "C"],
    [60, "D"],
    [59.9, "E"],
  ])("%s → %s", (score, grade) => {
    expect(finalGrade(score)).toBe(grade);
  });
});

describe("computeFinalScore", () => {
  it("memakai bobot siklus", () => {
    expect(computeFinalScore(80, 100, { kpi_weight: 50, feedback_weight: 50 })).toEqual({
      final_score: 90,
      final_grade: "A",
    });
  });

  it("bobot kosong jatuh ke default 70/30", () => {
    const result = computeFinalScore(80, 60, null);
    expect(result.final_score).toBeCloseTo(74);
    expect(result.final_grade).toBe("C");
  });
});
