import { describe, expect, it } from "vitest";
import {
  MAX_TRACKED_ORDERS,
  orderNeedsAttention,
  rememberOrderId,
  storedOrderIds,
  unpaidTotal,
} from "./my-orders";

describe("rememberOrderId / storedOrderIds", () => {
  it("pesanan terbaru di depan, tanpa duplikat, maksimal 10", () => {
    expect(rememberOrderId(["a", "b"], "c")).toEqual(["c", "a", "b"]);
    expect(rememberOrderId(["a", "b"], "b")).toEqual(["b", "a"]);
    const many = Array.from({ length: MAX_TRACKED_ORDERS }, (_, i) => `o${i}`);
    expect(rememberOrderId(many, "new")).toHaveLength(MAX_TRACKED_ORDERS);
    expect(rememberOrderId(many, "new")[0]).toBe("new");
  });

  it("penyimpanan lama (hanya activeOrderId) tetap terbaca", () => {
    expect(storedOrderIds({ activeOrderId: "x" })).toEqual(["x"]);
    expect(storedOrderIds({ orderIds: ["b", "a"], activeOrderId: "a" })).toEqual(["b", "a"]);
    expect(storedOrderIds({})).toEqual([]);
  });
});

describe("status daftar pesanan", () => {
  const order = (status: string, payment_status: string, total_amount = 10000) => ({ status, payment_status, total_amount });

  it("perlu perhatian: diproses atau belum lunas; batal tidak", () => {
    expect(orderNeedsAttention(order("preparing", "paid"))).toBe(true);
    expect(orderNeedsAttention(order("served", "unpaid"))).toBe(true);
    expect(orderNeedsAttention(order("completed", "paid"))).toBe(false);
    expect(orderNeedsAttention(order("cancelled", "unpaid"))).toBe(false);
  });

  it("total belum dibayar mengabaikan yang lunas & batal", () => {
    expect(
      unpaidTotal([order("served", "unpaid", 250200), order("pending", "unpaid", 50000), order("completed", "paid", 9000), order("voided", "unpaid", 7000)])
    ).toBe(300200);
  });
});
