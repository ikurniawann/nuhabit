"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet, apiPatch } from "@/lib/api-client";

export type ReviewStatus = "pending" | "published" | "rejected";

/** A product review in moderation (GET /api/shop/reviews). */
export type ShopReview = {
  id: string;
  productId: string;
  productName: string;
  customerId: string;
  customerName: string | null;
  orderId: string;
  orderNumber: string | null;
  rating: number;
  comment: string;
  status: ReviewStatus;
  createdAt: string;
};

const keys = {
  all: ["shop", "reviews"] as const,
  list: (status: string) => ["shop", "reviews", "list", status] as const,
};

/** Reviews by status; "" lists every status, pending first. */
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
      toast.success(status === "published" ? "Ulasan dipublikasikan" : status === "rejected" ? "Ulasan ditolak" : "Ulasan dikembalikan ke antrean");
      await queryClient.invalidateQueries({ queryKey: keys.all });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Gagal memperbarui ulasan"),
  });
}
