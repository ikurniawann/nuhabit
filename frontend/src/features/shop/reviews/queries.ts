"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet, apiPatch } from "@/lib/api-client";

export type ReviewStatus = "pending" | "published" | "rejected";

/** A product review in moderation (GET /api/shop/reviews). */
export type ShopReview = {
  id: string;
  product_id: string;
  product_name: string;
  customer_name: string;
  order_number: string;
  rating: number;
  comment: string | null;
  status: ReviewStatus;
  created_at: string;
  updated_at: string;
};

const keys = {
  all: ["shop", "reviews"] as const,
  list: (status: string) => ["shop", "reviews", "list", status] as const,
};

/** Reviews by status; "" lists every status. */
export const useShopReviews = (status: string) =>
  useQuery({
    queryKey: keys.list(status),
    queryFn: () =>
      apiGet<{ data: ShopReview[] }>(`/api/shop/reviews${status ? `?status=${status}` : ""}`).then((res) => res.data ?? []),
    placeholderData: keepPreviousData,
  });

export function useModerateReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: ReviewStatus }) => apiPatch(`/api/shop/reviews/${id}`, { status }),
    onSuccess: async (_result, { status }) => {
      toast.success(status === "published" ? "Ulasan dipublikasikan" : "Ulasan ditolak");
      await queryClient.invalidateQueries({ queryKey: keys.all });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Gagal memperbarui ulasan"),
  });
}
