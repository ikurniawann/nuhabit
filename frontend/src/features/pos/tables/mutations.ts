"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createPosTable,
  deletePosTable,
  patchPosTablePosition,
  updatePosTable,
} from "./api";
import { posTablesQueryKeys } from "./query-keys";
import type { PosTablePayload, PosTableRow } from "./types";

function useInvalidateTables() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: posTablesQueryKeys.all });
}

export function useCreatePosTable() {
  const invalidate = useInvalidateTables();
  return useMutation({
    mutationFn: (payload: PosTablePayload) => createPosTable(payload),
    onSuccess: invalidate,
  });
}

export function useUpdatePosTable() {
  const invalidate = useInvalidateTables();
  return useMutation({
    mutationFn: ({ id, ...payload }: PosTablePayload & { id: string }) =>
      updatePosTable(id, payload),
    onSuccess: invalidate,
  });
}

export function useDeletePosTable() {
  const invalidate = useInvalidateTables();
  return useMutation({
    mutationFn: (id: string) => deletePosTable(id),
    onSuccess: invalidate,
  });
}

export function usePatchPosTablePosition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      pos_x,
      pos_y,
    }: {
      id: string;
      pos_x: number;
      pos_y: number;
    }) => patchPosTablePosition(id, { pos_x, pos_y }),
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: posTablesQueryKeys.all });
      const previous = qc.getQueriesData<PosTableRow[]>({
        queryKey: posTablesQueryKeys.all,
      });
      qc.setQueriesData<PosTableRow[]>(
        { queryKey: posTablesQueryKeys.all },
        (old) => {
          if (!Array.isArray(old)) return old;
          return old.map((row) =>
            row.id === vars.id
              ? { ...row, pos_x: vars.pos_x, pos_y: vars.pos_y }
              : row
          );
        }
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      ctx?.previous?.forEach(([key, data]) => {
        qc.setQueryData(key, data);
      });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: posTablesQueryKeys.all });
    },
  });
}
