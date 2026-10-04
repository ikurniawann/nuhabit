"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createRawMaterial, updateRawMaterial, updateRawMaterialStatus, deleteRawMaterial } from "@/lib/purchasing/api-client/raw-materials";
import { rawMaterialsQueryKeys } from "./query-keys";

type CreatePayload = Parameters<typeof createRawMaterial>[0];
type UpdatePayload = Parameters<typeof updateRawMaterial>[1];

export function useCreateRawMaterial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreatePayload) => createRawMaterial(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...rawMaterialsQueryKeys.all, "list"] });
      qc.invalidateQueries({ queryKey: [...rawMaterialsQueryKeys.all, "detail"] });
    },
  });
}

export function useUpdateRawMaterial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdatePayload }) =>
      updateRawMaterial(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...rawMaterialsQueryKeys.all, "list"] });
      qc.invalidateQueries({ queryKey: [...rawMaterialsQueryKeys.all, "detail"] });
    },
  });
}

export function useUpdateRawMaterialStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      updateRawMaterialStatus(id, isActive),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...rawMaterialsQueryKeys.all, "list"] });
      qc.invalidateQueries({ queryKey: [...rawMaterialsQueryKeys.all, "detail"] });
    },
  });
}

export function useDeleteRawMaterial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteRawMaterial(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...rawMaterialsQueryKeys.all, "list"] });
      qc.invalidateQueries({ queryKey: [...rawMaterialsQueryKeys.all, "detail"] });
    },
  });
}
