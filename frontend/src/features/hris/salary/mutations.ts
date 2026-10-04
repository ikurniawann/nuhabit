"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { salaryQueryKeys } from "./query-keys";
import { createSalary, updateSalary } from "./api";
import type { SalaryPayload } from "./types";

export function useCreateSalary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: SalaryPayload) => createSalary(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: salaryQueryKeys.all }),
  });
}

export function useUpdateSalary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: SalaryPayload }) =>
      updateSalary(id, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: salaryQueryKeys.all }),
  });
}
