"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createSupplyUsage, createSupplyAdjustment } from "./api";
import { supplyInventoryKeys } from "./query-keys";

export function useCreateSupplyUsage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createSupplyUsage,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: supplyInventoryKeys.all });
    },
  });
}

export function useCreateSupplyAdjustment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createSupplyAdjustment,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: supplyInventoryKeys.all });
    },
  });
}
