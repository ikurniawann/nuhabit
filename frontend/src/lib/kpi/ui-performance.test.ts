import { describe, it, expect } from "vitest";
import {
  categoryClass,
  countPendingToday,
  formatScore,
  pickCurrentCycle,
  quarterOf,
  scoreToneClass,
  summarizeMyQuarter,
  summarizeMyReview,
  toScore,
} from "./ui-performance";

describe("toScore", () => {
  it("parses pg numerics and rejects blanks", () => {
    expect(toScore("87.50")).toBe(87.5);
    expect(toScore(null)).toBeNull();
    expect(toScore(undefined)).toBeNull();
    expect(toScore("abc")).toBeNull();
  });
});

describe("scoreToneClass", () => {
  it("bands scores", () => {
    expect(scoreToneClass(null)).toBe("text-gray-400");
    expect(scoreToneClass(90)).toBe("text-emerald-600");
    expect(scoreToneClass(75)).toBe("text-blue-600");
    expect(scoreToneClass(60)).toBe("text-amber-600");
    expect(scoreToneClass(59.9)).toBe("text-red-600");
  });
});

describe("formatScore", () => {
  it("formats with digits and treats zero as empty on request", () => {
    expect(formatScore(87.456, 1)).toBe("87.5");
    expect(formatScore(null, 0)).toBe("—");
    expect(formatScore(0, 1)).toBe("0.0");
    expect(formatScore(0, 1, true)).toBe("—");
  });
});

describe("categoryClass / quarterOf", () => {
  it("maps categories and quarters", () => {
    expect(categoryClass("Istimewa")).toContain("emerald");
    expect(categoryClass("Kurang")).toContain("red");
    expect(quarterOf(0)).toBe(1);
    expect(quarterOf(9)).toBe(4);
  });
});

describe("summarizeMyQuarter", () => {
  it("prefers my own row and parses scores", () => {
    const summary = summarizeMyQuarter({
      employees: [
        { id: "other", avg_score: "50", months: [] },
        { id: "me", avg_score: "88.25", months: [{ month: 7, score: "90" }, { month: 8, score: null }] },
      ],
      months: [7, 8, 9],
      year: 2026,
      quarter: 3,
      my_employee_id: "me",
    });
    expect(summary).toEqual({
      quarter: 3,
      year: 2026,
      avg: 88.25,
      monthScores: [
        { month: 7, score: 90 },
        { month: 8, score: null },
        { month: 9, score: null },
      ],
    });
  });

  it("falls back to the first row", () => {
    const summary = summarizeMyQuarter({
      employees: [{ id: "x", avg_score: null, months: null }],
      months: [1],
    });
    expect(summary.avg).toBeNull();
    expect(summary.monthScores).toEqual([{ month: 1, score: null }]);
  });
});

describe("pickCurrentCycle", () => {
  const cycles = [
    { id: "q4", start_date: "2026-10-01", end_date: "2026-12-31" },
    { id: "q3", start_date: "2026-07-01", end_date: "2026-09-30" },
  ];
  it("finds the cycle covering today, else the newest", () => {
    expect(pickCurrentCycle(cycles, "2026-08-15")?.id).toBe("q3");
    expect(pickCurrentCycle(cycles, "2027-02-01")?.id).toBe("q4");
    expect(pickCurrentCycle([], "2026-08-15")).toBeUndefined();
  });
});

describe("summarizeMyReview", () => {
  it("returns my review with zero treated as not scored", () => {
    const summary = summarizeMyReview("Q3 2026", {
      my_employee_id: "me",
      reviews: [
        {
          employee_id: "me",
          status: "draft",
          category: null,
          grand_total_score: "0",
          self_done: true,
          employee_sign_date: null,
        },
      ],
    });
    expect(summary).toEqual({
      cycleName: "Q3 2026",
      grand: null,
      category: null,
      status: "draft",
      selfDone: true,
      signed: false,
    });
    expect(summarizeMyReview("Q3", { my_employee_id: "x", reviews: [] })).toBeNull();
  });
});

describe("countPendingToday", () => {
  it("counts only today's pending occurrences", () => {
    expect(
      countPendingToday(
        [
          { occurrence_date: "2026-10-04", status: "pending" },
          { occurrence_date: "2026-10-04", status: "done" },
          { occurrence_date: "2026-10-03", status: "pending" },
        ],
        "2026-10-04"
      )
    ).toBe(1);
  });
});
