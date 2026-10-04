import { describe, expect, it } from "vitest";
import { sortTopProducts, topProductBarValue } from "./top-products";

const sample = [
  { product_name: "Kopi", quantity: 10, revenue: 200_000 },
  { product_name: "Air", quantity: 40, revenue: 80_000 },
  { product_name: "Roti", quantity: 8, revenue: 160_000 },
];

describe("sortTopProducts", () => {
  it("sorts by omset then keeps top N", () => {
    expect(sortTopProducts(sample, "omset", 2).map((p) => p.product_name)).toEqual([
      "Kopi",
      "Roti",
    ]);
  });

  it("sorts by qty then keeps top N", () => {
    expect(sortTopProducts(sample, "qty", 2).map((p) => p.product_name)).toEqual([
      "Air",
      "Kopi",
    ]);
  });

  it("breaks qty ties with omset", () => {
    expect(
      sortTopProducts(
        [
          { product_name: "A", quantity: 5, revenue: 10 },
          { product_name: "B", quantity: 5, revenue: 30 },
        ],
        "qty"
      ).map((p) => p.product_name)
    ).toEqual(["B", "A"]);
  });
});

describe("topProductBarValue", () => {
  it("uses the active metric", () => {
    const row = { quantity: 4, revenue: 90 };
    expect(topProductBarValue(row, "qty")).toBe(4);
    expect(topProductBarValue(row, "omset")).toBe(90);
  });
});
