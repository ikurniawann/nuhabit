"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  approveProductPurchaseOrder,
  cancelProductPurchaseOrder,
  createProductPurchaseOrder,
  sendProductPurchaseOrder,
} from "./api";
import { productPoQueryKeys } from "./query-keys";
import type { ProductPOFormPayload } from "./types";

export function useCreateProductPurchaseOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: ProductPOFormPayload) => createProductPurchaseOrder(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: productPoQueryKeys.all });
    },
  });
}

export function useApproveProductPurchaseOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => approveProductPurchaseOrder(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: productPoQueryKeys.all }),
  });
}

export function useSendProductPurchaseOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, sentVia }: { id: string; sentVia: "EMAIL" | "WHATSAPP" | "PRINT" | "OTHER" }) =>
      sendProductPurchaseOrder(id, sentVia),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: productPoQueryKeys.all }),
  });
}

export function useCancelProductPurchaseOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      cancelProductPurchaseOrder(id, reason),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: productPoQueryKeys.all }),
  });
}
