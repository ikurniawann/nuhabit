import { describe, expect, it } from "vitest";

import {
  canVoidOrderStatus,
  isPaidPosOrder,
  resolveArkRefundAmount,
  resolveCustomerStatsReversal,
} from "./void-order";

describe("canVoidOrderStatus", () => {
  it("mengizinkan pending dan completed", () => {
    expect(canVoidOrderStatus("pending")).toBe(true);
    expect(canVoidOrderStatus("completed")).toBe(true);
    expect(canVoidOrderStatus("preparing")).toBe(true);
  });

  it("menolak cancelled / voided / merged", () => {
    expect(canVoidOrderStatus("cancelled")).toBe(false);
    expect(canVoidOrderStatus("voided")).toBe(false);
    expect(canVoidOrderStatus("merged")).toBe(false);
  });
});

describe("isPaidPosOrder", () => {
  it("lunas bila completed atau payment paid", () => {
    expect(isPaidPosOrder({ status: "completed", payment_status: "unpaid" })).toBe(true);
    expect(isPaidPosOrder({ status: "pending", payment_status: "paid" })).toBe(true);
    expect(isPaidPosOrder({ status: "pending", payment_status: "unpaid" })).toBe(false);
  });
});

describe("resolveArkRefundAmount", () => {
  it("pakai ledger wallet sekali, bukan jumlah child", () => {
    expect(
      resolveArkRefundAmount({
        paymentMethod: "ark_coin",
        walletPaymentAmount: 50_000,
        orders: [
          { ark_coins_used: 50_000, total_amount: 30_000 },
          { ark_coins_used: 0, total_amount: 20_000 },
        ],
      })
    ).toBe(50_000);
  });

  it("fallback ke ark_coins_used terbesar", () => {
    expect(
      resolveArkRefundAmount({
        paymentMethod: "ark_coin",
        orders: [
          { ark_coins_used: 12_000, total_amount: 12_000 },
          { ark_coins_used: 0, total_amount: 8_000 },
        ],
      })
    ).toBe(12_000);
  });

  it("ARK tanpa stamp → jumlah total family", () => {
    expect(
      resolveArkRefundAmount({
        paymentMethod: "ark_coin",
        orders: [{ total_amount: 10_000 }, { total_amount: 5_000 }],
      })
    ).toBe(15_000);
  });

  it("tunai tanpa ARK → 0", () => {
    expect(
      resolveArkRefundAmount({
        paymentMethod: "cash",
        orders: [{ total_amount: 10_000 }],
      })
    ).toBe(0);
  });
});

describe("resolveCustomerStatsReversal", () => {
  it("satu visit untuk seluruh family", () => {
    expect(
      resolveCustomerStatsReversal({
        customerId: "c1",
        paidOrders: [{ total_amount: 10_000 }, { total_amount: 5_000 }],
      })
    ).toEqual({ customerId: "c1", amount: 15_000, visitDelta: 1 });
  });

  it("tanpa customer → null", () => {
    expect(
      resolveCustomerStatsReversal({
        customerId: null,
        paidOrders: [{ total_amount: 10_000 }],
      })
    ).toBeNull();
  });
});
