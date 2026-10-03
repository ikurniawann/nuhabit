"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PurchaseReturnFormData } from "@/types/purchasing";
import { createReturn, approveReturn, rejectReturn, updateReturn, reviseReturn } from "./api";
import { returnsQueryKeys } from "./query-keys";

export const useCreateReturn = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: PurchaseReturnFormData) => createReturn(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: returnsQueryKeys.all });
    },
  });
};

export const useApproveReturn = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => approveReturn(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: returnsQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: returnsQueryKeys.detail(id) });
    },
  });
};

export const useRejectReturn = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => rejectReturn(id, reason),
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: returnsQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: returnsQueryKeys.detail(id) });
    },
  });
};

export const useUpdateReturn = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: PurchaseReturnFormData }) =>
      updateReturn(id, data),
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: returnsQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: returnsQueryKeys.detail(id) });
    },
  });
};

export const useReviseReturn = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => reviseReturn(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: returnsQueryKeys.all });
    },
  });
};
