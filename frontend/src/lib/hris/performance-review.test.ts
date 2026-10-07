import { describe, expect, it } from "vitest";
import {
  behaviorScore,
  combineReviewScores,
  quarterLabel,
  quarterMonths,
  quarterRange,
} from "./performance-review";

describe("quarterMonths / quarterRange / quarterLabel", () => {
  it("memetakan kuartal ke bulan yang benar", () => {
    expect(quarterMonths(1)).toEqual([1, 2, 3]);
    expect(quarterMonths(3)).toEqual([7, 8, 9]);
    expect(quarterMonths(4)).toEqual([10, 11, 12]);
  });

  it("menghitung rentang tanggal termasuk akhir bulan yang benar", () => {
    expect(quarterRange(2026, 1)).toEqual({ start: "2026-01-01", end: "2026-03-31" });
    expect(quarterRange(2026, 2)).toEqual({ start: "2026-04-01", end: "2026-06-30" });
    // Februari kabisat
    expect(quarterRange(2028, 1).end).toBe("2028-03-31");
  });

  it("membuat label kuartal", () => {
    expect(quarterLabel(2026, 3)).toBe("Q3 2026");
  });
});

describe("combineReviewScores", () => {
  it("menggabungkan 60/30/10 saat lengkap", () => {
    expect(combineReviewScores({ work: 80, behavior: 90, project: 100 })).toBe(85);
  });

  it("meredistribusi bobot komponen yang kosong", () => {
    // Hanya work + behavior → 60:30 → 2/3 dan 1/3
    expect(combineReviewScores({ work: 90, behavior: 60, project: null })).toBe(80);
    // Hanya work → 100%
    expect(combineReviewScores({ work: 77.5, behavior: null, project: null })).toBe(77.5);
  });

  it("null bila semua komponen kosong", () => {
    expect(combineReviewScores({ work: null, behavior: null, project: null })).toBeNull();
  });
});

describe("behaviorScore", () => {
  it("mengubah skor 1–5 bertimbang menjadi 0–100", () => {
    expect(
      behaviorScore([
        { score: 5, weight: 20 },
        { score: 4, weight: 20 },
        { score: 3, weight: 20 },
        { score: 4, weight: 20 },
        { score: 4, weight: 20 },
      ])
    ).toBe(80);
  });

  it("mengabaikan item yang belum dinilai (bukan dihitung nol)", () => {
    expect(
      behaviorScore([
        { score: 5, weight: 20 },
        { score: null, weight: 20 },
      ])
    ).toBe(100);
  });

  it("null bila belum ada item yang dinilai", () => {
    expect(behaviorScore([{ score: null, weight: 20 }])).toBeNull();
    expect(behaviorScore([])).toBeNull();
  });
});
