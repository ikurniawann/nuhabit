"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SupplierFormData } from "@/types/supplier";
import { suppliersQueryKeys } from "./query-keys";
import {
  createSupplier,
  updateSupplier,
  updateSupplierStatus,
  deactivateSupplier,
} from "@/lib/purchasing/supplier";

export function useCreateSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: SupplierFormData) => createSupplier(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: suppliersQueryKeys.all }),
  });
}

export function useUpdateSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<SupplierFormData> }) =>
      updateSupplier(id, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: suppliersQueryKeys.all }),
  });
}

export function useUpdateSupplierStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      updateSupplierStatus(id, isActive),
    onSuccess: () => qc.invalidateQueries({ queryKey: suppliersQueryKeys.all }),
  });
}

export function useDeleteSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deactivateSupplier(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: suppliersQueryKeys.all }),
  });
}
