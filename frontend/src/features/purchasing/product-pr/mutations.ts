"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createProductPurchaseRequest, updateProductPurchaseRequest } from "./api";
import { productPrQueryKeys } from "./query-keys";
import type { ProductPRFormPayload } from "./types";

export const useCreateProductPurchaseRequest = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: ProductPRFormPayload) => createProductPurchaseRequest(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: productPrQueryKeys.all });
    },
  });
};

export const useUpdateProductPurchaseRequest = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: ProductPRFormPayload }) =>
      updateProductPurchaseRequest(id, payload),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: productPrQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: productPrQueryKeys.detail(variables.id) });
    },
  });
};
