import type { ShopReview } from "./queries";

const RANK: Record<ShopReview["status"], number> = { pending: 0, published: 1, rejected: 2 };

/** Pending reviews first, then by newest. */
export function sortReviewsForModeration(reviews: ShopReview[]): ShopReview[] {
  return [...reviews].sort((a, b) => RANK[a.status] - RANK[b.status] || b.created_at.localeCompare(a.created_at));
}
