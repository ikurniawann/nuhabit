import { describe, expect, it } from "vitest";
import { safeEqual } from "./compare";

describe("safeEqual", () => {
  it("cocok hanya bila isi sama persis", () => {
    expect(safeEqual("rahasia", "rahasia")).toBe(true);
    expect(safeEqual("rahasia", "rahasiA")).toBe(false);
    expect(safeEqual("rahasia", "rahasia-panjang")).toBe(false);
  });

  it("sisi kosong selalu false, termasuk kosong lawan kosong", () => {
    expect(safeEqual("", "")).toBe(false);
    expect(safeEqual(null, null)).toBe(false);
    expect(safeEqual(undefined, "x")).toBe(false);
    expect(safeEqual("x", "")).toBe(false);
  });
});
