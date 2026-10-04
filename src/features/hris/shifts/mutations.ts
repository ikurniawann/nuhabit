"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { deleteShift, saveShift } from "./api";
import { shiftQueryKeys } from "./query-keys";
import type { ShiftPayload } from "./types";

export function useSaveShift() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ payload, id }: { payload: ShiftPayload; id?: string }) => saveShift(payload, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: shiftQueryKeys.list() }),
  });
}

export function useDeleteShift() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteShift,
    onSuccess: () => qc.invalidateQueries({ queryKey: shiftQueryKeys.list() }),
  });
}
