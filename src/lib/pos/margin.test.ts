import { describe, expect, it } from "vitest";
import { computeMarginPercentage } from "./margin";

describe("computeMarginPercentage", () => {
  it("menghitung margin dua desimal", () => {
    expect(computeMarginPercentage(30000, 12000)).toBe(60);
    expect(computeMarginPercentage(3, 1)).toBe(66.67);
  });
  it("harga nol atau negatif memberi 0", () => {
    expect(computeMarginPercentage(0, 1000)).toBe(0);
  });
});
