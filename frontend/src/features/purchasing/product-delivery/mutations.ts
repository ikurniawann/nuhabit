"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CreateProductDeliveryPayload } from "./types";
import { createProductDelivery } from "./api";
import { productDeliveryQueryKeys } from "./query-keys";

export function useCreateProductDelivery() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateProductDeliveryPayload) => createProductDelivery(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: productDeliveryQueryKeys.all });
    },
  });
}
