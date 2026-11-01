"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { patchPosProduct, syncPurchasingProducts } from "./api";
import { productsQueryKeys } from "./query-keys";
import type { PatchPosProductPayload } from "./types";

export const usePatchPosProduct = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: PatchPosProductPayload }) =>
      patchPosProduct(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: productsQueryKeys.all });
    },
  });
};

export const useSyncPurchasingProducts = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: syncPurchasingProducts,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: productsQueryKeys.catalog() });
    },
  });
};
