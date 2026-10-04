"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createOfferRule,
  deleteOfferRule,
  fetchOfferRules,
  updateOfferRule,
} from "./api";
import type { OfferRulePayload, OfferType } from "./types";

export const offerRuleKeys = {
  all: ["promo", "offers"] as const,
  list: (type: OfferType) => ["promo", "offers", type] as const,
};

export function useOfferRules(type: OfferType) {
  return useQuery({
    queryKey: offerRuleKeys.list(type),
    queryFn: () => fetchOfferRules(type),
  });
}

export function useCreateOfferRule(type: OfferType) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: OfferRulePayload) => createOfferRule(payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: offerRuleKeys.list(type) });
    },
  });
}

export function useUpdateOfferRule(type: OfferType) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: OfferRulePayload }) =>
      updateOfferRule(id, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: offerRuleKeys.list(type) });
    },
  });
}

export function useDeleteOfferRule(type: OfferType) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteOfferRule(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: offerRuleKeys.list(type) });
    },
  });
}
