import { describe, expect, it } from "vitest";
import {
  buildPaymentAccountingAmounts,
  buildReturnAccountingAmounts,
  computeGrnAmountsFromLines,
} from "@/lib/purchasing/accounting-amounts";

describe("computeGrnAmountsFromLines", () => {
  it("sums qty × harga and applies PPN", () => {
    const amounts = computeGrnAmountsFromLines(
      [
        { qty: 10, harga_satuan: 1000 },
        { qty: 5, harga_satuan: 2000 },
      ],
      11
    );
    expect(amounts.SUBTOTAL).toBe(20000);
    expect(amounts.TAX).toBe(2200);
    expect(amounts.TOTAL).toBe(22200);
  });

  it("ignores non-positive lines", () => {
    const amounts = computeGrnAmountsFromLines([
      { qty: 0, harga_satuan: 1000 },
      { qty: 3, harga_satuan: 500 },
    ]);
    expect(amounts.TOTAL).toBe(1500);
    expect(amounts.TAX).toBe(0);
  });
});

describe("buildPaymentAccountingAmounts", () => {
  it("maps paid amount to PAID/TOTAL", () => {
    expect(buildPaymentAccountingAmounts(7500)).toEqual({
      PAID: 7500,
      TOTAL: 7500,
      SUBTOTAL: 7500,
    });
  });
});

describe("buildReturnAccountingAmounts", () => {
  it("maps return total", () => {
    expect(buildReturnAccountingAmounts(1200.456).TOTAL).toBe(1200.46);
  });
});
