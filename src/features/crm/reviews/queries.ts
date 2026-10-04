"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteGoogleBusinessConfig,
  fetchGoogleBusinessConfig,
  fetchReviews,
  postReviewAction,
  saveGoogleBusinessConfig,
  type ReviewFilters,
} from "./api";

export const reviewsQueryKeys = {
  all: ["crm", "reviews"] as const,
  lists: ["crm", "reviews", "list"] as const,
  list: (filters: ReviewFilters) => ["crm", "reviews", "list", filters] as const,
  googleConfig: ["crm", "reviews", "google-config"] as const,
};

export const useReviews = (filters: ReviewFilters) =>
  useQuery({ queryKey: reviewsQueryKeys.list(filters), queryFn: () => fetchReviews(filters) });

/** Aksi ulasan; sukses → daftar dimuat ulang sebelum promise selesai. */
export function useReviewAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: postReviewAction,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: reviewsQueryKeys.lists }),
  });
}

export const useGoogleBusinessConfig = () =>
  useQuery({ queryKey: reviewsQueryKeys.googleConfig, queryFn: fetchGoogleBusinessConfig });

/** Simpan/putuskan kredensial; sukses → konfigurasi dan daftar ulasan dimuat ulang. */
export function useGoogleBusinessMutations() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: reviewsQueryKeys.all });
  return {
    save: useMutation({ mutationFn: saveGoogleBusinessConfig, onSuccess: refresh }),
    disconnect: useMutation({ mutationFn: deleteGoogleBusinessConfig, onSuccess: refresh }),
  };
}
