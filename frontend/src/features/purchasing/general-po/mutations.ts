"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  approveGeneralPurchaseOrder,
  cancelGeneralPurchaseOrder,
  createGeneralPurchaseOrder,
  sendGeneralPurchaseOrder,
} from "./api";
import { generalPoQueryKeys } from "./query-keys";
import type { GeneralPOFormPayload } from "./types";

export function useCreateGeneralPurchaseOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: GeneralPOFormPayload) => createGeneralPurchaseOrder(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: generalPoQueryKeys.all });
    },
  });
}

export function useApproveGeneralPurchaseOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => approveGeneralPurchaseOrder(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: generalPoQueryKeys.all }),
  });
}

export function useSendGeneralPurchaseOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, sentVia }: { id: string; sentVia: "EMAIL" | "WHATSAPP" | "PRINT" | "OTHER" }) =>
      sendGeneralPurchaseOrder(id, sentVia),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: generalPoQueryKeys.all }),
  });
}

export function useCancelGeneralPurchaseOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      cancelGeneralPurchaseOrder(id, reason),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: generalPoQueryKeys.all }),
  });
}
