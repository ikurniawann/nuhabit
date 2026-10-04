"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { coaQueryKeys } from "./query-keys";
import {
  createCoaAccount,
  updateCoaAccount,
  deleteCoaAccount,
  importCoaFile,
} from "./api";
import type { CoaAccountPayload } from "./types";

function useInvalidateCoa() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: coaQueryKeys.all });
}

export function useCreateCoaAccount() {
  const invalidate = useInvalidateCoa();
  return useMutation({
    mutationFn: (payload: CoaAccountPayload) => createCoaAccount(payload),
    onSuccess: invalidate,
  });
}

export function useUpdateCoaAccount() {
  const invalidate = useInvalidateCoa();
  return useMutation({
    mutationFn: ({ id, ...payload }: CoaAccountPayload & { id: string }) =>
      updateCoaAccount(id, payload),
    onSuccess: invalidate,
  });
}

export function useDeleteCoaAccount() {
  const invalidate = useInvalidateCoa();
  return useMutation({
    mutationFn: (id: string) => deleteCoaAccount(id),
    onSuccess: invalidate,
  });
}

export function useImportCoa() {
  const invalidate = useInvalidateCoa();
  return useMutation({
    mutationFn: ({
      file,
      mode,
    }: {
      file: File;
      mode: "preview" | "commit";
    }) => importCoaFile(file, mode),
    onSuccess: (_data, vars) => {
      if (vars.mode === "commit") invalidate();
    },
  });
}
