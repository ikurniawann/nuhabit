"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createPurchaseRequest, submitPurchaseRequest, updatePurchaseRequest } from "./api";
import { prQueryKeys } from "./query-keys";
import type { PRFormPayload } from "./types";

export const useCreatePurchaseRequest = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: PRFormPayload) => createPurchaseRequest(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: prQueryKeys.all });
    },
  });
};

export const useUpdatePurchaseRequest = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: PRFormPayload }) =>
      updatePurchaseRequest(id, payload),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: prQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: prQueryKeys.detail(variables.id) });
    },
  });
};

export const useSubmitPurchaseRequest = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => submitPurchaseRequest(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: prQueryKeys.all }),
  });
};
