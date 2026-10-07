import { describe, expect, test } from "vitest";
import { cleanReviewText, reviewEligibility, summarizeReviews, type ReviewableOrder } from "./member-reviews";

const NOW = new Date("2026-10-15T10:00:00Z");
const order: ReviewableOrder = {
  customer_id: "me",
  payment_status: "paid",
  status: "completed",
  paid_at: "2026-10-01T10:00:00Z",
};
const ctx = { customerId: "me", now: NOW, alreadyReviewed: false };

describe("reviewEligibility", () => {
  test("order lunas milik member, tepat 14 hari → boleh", () => {
    expect(reviewEligibility(order, ctx)).toEqual({ ok: true });
  });
  test("lewat 14 hari ditolak", () => {
    expect(reviewEligibility({ ...order, paid_at: "2026-10-01T09:59:59Z" }, ctx)).toEqual({
      ok: false,
      reason: "lewat-batas-waktu",
    });
  });
  test("satu ulasan per order", () => {
    expect(reviewEligibility(order, { ...ctx, alreadyReviewed: true })).toEqual({ ok: false, reason: "sudah-diulas" });
  });
  test("order orang lain, belum lunas, batal, atau tidak ada", () => {
    expect(reviewEligibility({ ...order, customer_id: "lain" }, ctx)).toEqual({ ok: false, reason: "bukan-order-member" });
    expect(reviewEligibility({ ...order, payment_status: "unpaid" }, ctx)).toEqual({ ok: false, reason: "belum-lunas" });
    expect(reviewEligibility({ ...order, status: "voided" }, ctx)).toEqual({ ok: false, reason: "order-batal" });
    expect(reviewEligibility(null, ctx)).toEqual({ ok: false, reason: "order-tidak-ditemukan" });
  });
});

describe("summarizeReviews", () => {
  test("rata-rata, sebaran bintang, dan per outlet", () => {
    const summary = summarizeReviews([
      { branch_id: "a", branch_name: "Dago", rating: 5, n: 3 },
      { branch_id: "a", branch_name: "Dago", rating: 4, n: 1 },
      { branch_id: "b", branch_name: "Braga", rating: 2, n: 1 },
      { branch_id: null, branch_name: null, rating: 9, n: 4 },
    ]);
    expect(summary.count).toBe(5);
    expect(summary.average).toBe(4.2);
    expect(summary.distribution).toEqual([0, 1, 0, 1, 3]);
    expect(summary.outlets).toEqual([
      { branch_id: "a", name: "Dago", count: 4, average: 4.8 },
      { branch_id: "b", name: "Braga", count: 1, average: 2 },
    ]);
  });
  test("tanpa ulasan → rata-rata null", () => {
    expect(summarizeReviews([])).toMatchObject({ count: 0, average: null, distribution: [0, 0, 0, 0, 0] });
  });
});

describe("cleanReviewText", () => {
  test("spasi dipangkas, kosong jadi null, dipotong di batas", () => {
    expect(cleanReviewText("  enak  ")).toBe("enak");
    expect(cleanReviewText("   ")).toBeNull();
    expect(cleanReviewText("x".repeat(20), 5)).toBe("xxxxx");
  });
});
