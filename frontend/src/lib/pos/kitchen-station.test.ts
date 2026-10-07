import { describe, expect, it } from "vitest";
import { resolvePosStation } from "@/lib/pos/kitchen-station";

describe("resolvePosStation", () => {
  it("uses explicit station when valid", () => {
    expect(resolvePosStation("bar", "Makanan")).toBe("bar");
    expect(resolvePosStation("Kitchen", null)).toBe("kitchen");
    expect(resolvePosStation("dessert", "Minuman")).toBe("dessert");
  });

  it("falls back to kategori heuristic when station empty", () => {
    expect(resolvePosStation(null, "Minuman")).toBe("bar");
    expect(resolvePosStation("", "Coffee")).toBe("bar");
    expect(resolvePosStation(undefined, "Roti & Cake")).toBe("bakery");
    expect(resolvePosStation("  ", "Makanan")).toBe("kitchen");
  });

  it("ignores invalid explicit values", () => {
    expect(resolvePosStation("kasir", "Minuman")).toBe("bar");
    expect(resolvePosStation("unknown", "Snack")).toBe("kitchen");
  });
});
