"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CreateProductionOrderPayload } from "./types";
import { createProductionOrder, updateProductionOrder } from "./api";
import { productionQueryKeys } from "./query-keys";

export const useCreateProductionOrder = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateProductionOrderPayload) =>
      createProductionOrder(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: productionQueryKeys.all });
    },
  });
};

export const useUpdateProductionOrder = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Record<string, unknown> }) =>
      updateProductionOrder(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: productionQueryKeys.all });
    },
  });
};
