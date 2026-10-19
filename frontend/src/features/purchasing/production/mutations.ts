"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { AdditionalCostPayload } from "@/lib/purchasing/cogs-additional-cost-ui";
import type { CreateProductionOrderPayload } from "./types";
import {
  createAdditionalCost,
  createProductionOrder,
  createProductionSubOrders,
  deleteAdditionalCost,
  issueProductionMaterials,
  receiveProductionBatch,
  returnProductionMaterials,
  saveRecipeSettings,
  updateProductionOrder,
} from "./api";
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

/** Keluarkan bahan dan terima hasil mengubah order, stok dan WIP: seluruh cache produksi disegarkan. */
export const useIssueProductionMaterials = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, payload }: { orderId: string; payload: Parameters<typeof issueProductionMaterials>[1] }) =>
      issueProductionMaterials(orderId, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: productionQueryKeys.all }),
  });
};

export const useCreateProductionSubOrders = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (orderId: string) => createProductionSubOrders(orderId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: productionQueryKeys.all }),
  });
};

export const useReturnProductionMaterials = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, payload }: { orderId: string; payload: Parameters<typeof returnProductionMaterials>[1] }) =>
      returnProductionMaterials(orderId, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: productionQueryKeys.all }),
  });
};

export const useReceiveProductionBatch = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, payload }: { orderId: string; payload: Parameters<typeof receiveProductionBatch>[1] }) =>
      receiveProductionBatch(orderId, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: productionQueryKeys.all }),
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

export const useSaveRecipeSettings = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => saveRecipeSettings(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: productionQueryKeys.all });
    },
  });
};
