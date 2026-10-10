import { describe, expect, it } from "vitest";
import { sortReviewsForModeration } from "./moderation";
import type { ShopReview } from "./queries";

const review = (id: string, status: ShopReview["status"], createdAt: string): ShopReview => ({
  id,
  productId: "p",
  productName: "Tee",
  customerId: "c",
  customerName: null,
  orderId: "o",
  orderNumber: null,
  rating: 5,
  comment: "",
  status,
  createdAt,
});

describe("sortReviewsForModeration", () => {
  it("puts pending reviews first, newest first within a status", () => {
    const sorted = sortReviewsForModeration([
      review("old-pub", "published", "2026-10-01"),
      review("old-pending", "pending", "2026-10-02"),
      review("rejected", "rejected", "2026-10-09"),
      review("new-pending", "pending", "2026-10-08"),
    ]);
    expect(sorted.map((item) => item.id)).toEqual(["new-pending", "old-pending", "old-pub", "rejected"]);
  });
});
