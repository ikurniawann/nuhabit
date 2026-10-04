"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createLoan, decideLoan } from "./api";
import { loanQueryKeys } from "./query-keys";

export function useCreateLoan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createLoan,
    onSuccess: () => qc.invalidateQueries({ queryKey: loanQueryKeys.lists() }),
  });
}

export function useDecideLoan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: decideLoan,
    onSuccess: () => qc.invalidateQueries({ queryKey: loanQueryKeys.lists() }),
  });
}
