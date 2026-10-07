"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchOffer, respondOffer } from "./api";
import type { OfferRespondAction } from "./types";

const offerKey = (token: string) => ["offer-portal", token] as const;

/** Rincian offer kandidat; token salah = galat final, tanpa retry. */
export function useOffer(token: string) {
  return useQuery({ queryKey: offerKey(token), queryFn: () => fetchOffer(token), retry: false });
}

export function useRespondOffer(token: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ action, note }: { action: OfferRespondAction; note?: string }) => respondOffer(token, action, note),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: offerKey(token) }),
    retry: false,
  });
}
