import { describe, expect, it } from "vitest";
import { applyStallScopeToProductIds, type StallProductScope } from "./stall-product-scope";

describe("applyStallScopeToProductIds", () => {
  it("returns null for unscoped/all mode", () => {
    const scope: StallProductScope = { mode: "all" };
    expect(applyStallScopeToProductIds(scope)).toBeNull();
  });

  it("returns empty array when no stalls assigned", () => {
    const scope: StallProductScope = { mode: "none" };
    expect(applyStallScopeToProductIds(scope)).toEqual([]);
  });

  it("returns product ids for stall scope", () => {
    const scope: StallProductScope = {
      mode: "ids",
      productIds: ["a", "b"],
      warehouseIds: ["w1"],
    };
    expect(applyStallScopeToProductIds(scope)).toEqual(["a", "b"]);
  });
});
