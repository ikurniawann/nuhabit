"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { AdditionalCostPayload } from "@/lib/purchasing/cogs-additional-cost-ui";
import type { CreateProductionOrderPayload } from "./types";
import { createAdditionalCost, createProductionOrder, deleteAdditionalCost, updateProductionOrder } from "./api";
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

/** Biaya tambahan mengubah estimasi COGS, jadi seluruh cache produksi disegarkan. */
export const useCreateAdditionalCost = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: AdditionalCostPayload) => createAdditionalCost(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: productionQueryKeys.all }),
  });
};

export const useDeleteAdditionalCost = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteAdditionalCost(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: productionQueryKeys.all }),
  });
};
