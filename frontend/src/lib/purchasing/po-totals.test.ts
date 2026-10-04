import { describe, expect, it } from "vitest";
import { computePoTotals, sumPoLines } from "@/lib/purchasing/po-totals";

describe("sumPoLines", () => {
  it("sums qty × price minus line discount, coercing numeric strings", () => {
    expect(
      sumPoLines([
        { qty_ordered: "2", harga_satuan: "15000", diskon_item: "1000" },
        { qty_ordered: 3, harga_satuan: 5000 },
      ])
    ).toBe(44_000);
  });
});

describe("computePoTotals", () => {
  it("prefers the percentage discount and taxes the net amount (default PPN 11%)", () => {
    expect(computePoTotals(100_000, { diskon_persen: 10, diskon_nominal: 5_000 })).toEqual({
      subtotal: 100_000,
      diskon_nominal: 10_000,
      ppn_nominal: 9_900,
      total: 99_900,
    });
  });

  it("falls back to the nominal discount and never taxes below zero", () => {
    expect(computePoTotals(10_000, { diskon_persen: 0, diskon_nominal: 15_000, ppn_persen: 11 })).toEqual({
      subtotal: 10_000,
      diskon_nominal: 15_000,
      ppn_nominal: 0,
      total: 0,
    });
  });

  it("reads numeric strings from the database", () => {
    expect(computePoTotals(200_000, { diskon_persen: "5.00" as unknown as number, ppn_persen: 0 }).total).toBe(190_000);
  });
});
