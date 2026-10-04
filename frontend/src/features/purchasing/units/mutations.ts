"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { UnitFormData } from "@/types/purchasing";
import { createUnit, updateUnit, updateUnitStatus, deleteUnit } from "@/lib/purchasing/api-client/units";
import { unitsQueryKeys } from "./query-keys";

export function useCreateUnit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: UnitFormData) => createUnit(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: unitsQueryKeys.all }),
  });
}

export function useUpdateUnit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UnitFormData }) =>
      updateUnit(id, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: unitsQueryKeys.all }),
  });
}

export function useUpdateUnitStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      updateUnitStatus(id, isActive),
    onSuccess: () => qc.invalidateQueries({ queryKey: unitsQueryKeys.all }),
  });
}

export function useDeleteUnit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteUnit(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: unitsQueryKeys.all }),
  });
}
