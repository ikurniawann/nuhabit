"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { submitCancelTopup, submitTopup } from "./api";
import { topupQueryKeys } from "./query-keys";
import type { ProcessTopupPayload } from "./types";

export const useProcessTopup = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: ProcessTopupPayload) => submitTopup(payload),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: topupQueryKeys.all });
      if (variables.customer_id) {
        queryClient.invalidateQueries({
          queryKey: topupQueryKeys.history(variables.customer_id),
        });
      }
    },
  });
};

export const useCancelTopup = (customerId?: string | null) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (topupId: string) => submitCancelTopup(topupId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: topupQueryKeys.all });
      if (customerId) {
        queryClient.invalidateQueries({
          queryKey: topupQueryKeys.history(customerId),
        });
      }
    },
  });
};
