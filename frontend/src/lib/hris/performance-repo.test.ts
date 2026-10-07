import { describe, expect, it } from "vitest";
import { parseBehaviorScore, parseProjectScore } from "./performance-repo";

describe("parseBehaviorScore", () => {
  it("menerima bilangan bulat 1–5", () => {
    expect(parseBehaviorScore(1)).toBe(1);
    expect(parseBehaviorScore("5")).toBe(5);
  });
  it.each([0, 6, 2.5, "x", undefined])("menolak %s", (value) => {
    expect(() => parseBehaviorScore(value)).toThrow("Skor harus 1–5");
  });
});

describe("parseProjectScore", () => {
  it("kosong → null, 0–100 diterima", () => {
    expect(parseProjectScore(null)).toBeNull();
    expect(parseProjectScore(undefined)).toBeNull();
    expect(parseProjectScore("87.5")).toBe(87.5);
  });
  it.each([-1, 101, "abc"])("menolak %s", (value) => {
    expect(() => parseProjectScore(value)).toThrow("Nilai kontribusi harus 0–100");
  });
});
