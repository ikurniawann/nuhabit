"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CreateDeliveryPayload } from "./types";
import { createDelivery } from "./api";
import { deliveryQueryKeys } from "./query-keys";

export const useCreateDelivery = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateDeliveryPayload) => createDelivery(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: deliveryQueryKeys.all });
    },
  });
};
