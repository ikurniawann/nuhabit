"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createGeneralPurchaseRequest, updateGeneralPurchaseRequest } from "./api";
import { generalPrQueryKeys } from "./query-keys";
import type { GeneralPRFormPayload } from "./types";

export const useCreateGeneralPurchaseRequest = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: GeneralPRFormPayload) => createGeneralPurchaseRequest(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: generalPrQueryKeys.all });
    },
  });
};

export const useUpdateGeneralPurchaseRequest = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: GeneralPRFormPayload }) =>
      updateGeneralPurchaseRequest(id, payload),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: generalPrQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: generalPrQueryKeys.detail(variables.id) });
    },
  });
};
