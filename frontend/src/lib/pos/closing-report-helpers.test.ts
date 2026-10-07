import { describe, expect, it } from "vitest";
import {
  isFullDiscountOrder,
  summarizeClosingTransactions,
} from "./closing-report-helpers";

describe("isFullDiscountOrder", () => {
  it("detects 100% off when discount covers subtotal", () => {
    expect(
      isFullDiscountOrder({
        subtotal: 80_000,
        discount_amount: 80_000,
        total_amount: 0,
      })
    ).toBe(true);
  });

  it("rejects partial discount", () => {
    expect(
      isFullDiscountOrder({
        subtotal: 80_000,
        discount_amount: 8_000,
        total_amount: 72_000,
      })
    ).toBe(false);
  });
});

describe("summarizeClosingTransactions", () => {
  it("counts sales, discount, and complimentary bills", () => {
    expect(
      summarizeClosingTransactions([
        { subtotal: 100_000, discount_amount: 10_000, total_amount: 90_000 },
        { subtotal: 50_000, discount_amount: 50_000, total_amount: 0 },
        { subtotal: 40_000, discount_amount: 0, total_amount: 40_000 },
      ])
    ).toEqual({
      transactions: 3,
      sales: 130_000,
      discount: 60_000,
      full_discount_transactions: 1,
      full_discount_amount: 50_000,
    });
  });
});
