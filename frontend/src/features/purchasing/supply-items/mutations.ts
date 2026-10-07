"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createSupplyItem, updateSupplyItem, deleteSupplyItem } from "./api";
import { supplyItemsQueryKeys } from "./query-keys";
import type { SupplyItemFormData } from "./types";

export const useCreateSupplyItem = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: SupplyItemFormData) => createSupplyItem(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: supplyItemsQueryKeys.all }),
  });
};

export const useUpdateSupplyItem = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<SupplyItemFormData> }) =>
      updateSupplyItem(id, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: supplyItemsQueryKeys.all }),
  });
};

export const useDeleteSupplyItem = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteSupplyItem(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: supplyItemsQueryKeys.all }),
  });
};
