"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  deleteGrn,
  updateGrn,
  createGrn,
  createQCInspection,
  type CreateGrnPayload,
  type SubmitGrnQcPayload,
  type UpdateGrnPayload,
} from "./api";
import { grnQueryKeys } from "./query-keys";

export const useDeleteGrn = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteGrn(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: grnQueryKeys.all });
    },
  });
};

export const useUpdateGrn = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateGrnPayload }) =>
      updateGrn(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: grnQueryKeys.all });
    },
  });
};

export const useCreateGrn = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateGrnPayload) => createGrn(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: grnQueryKeys.all });
    },
  });
};

export const useCreateQCInspection = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ grnId, payload }: { grnId: string; payload: SubmitGrnQcPayload }) =>
      createQCInspection(grnId, payload),
    onSuccess: () => {
      // Prefiks "all" mencakup detail, QC dan vendor credit GRN ini.
      queryClient.invalidateQueries({ queryKey: grnQueryKeys.all });
    },
  });
};
