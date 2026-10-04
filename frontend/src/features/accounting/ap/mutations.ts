"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createApPayment } from "./api";
import { apKeys } from "./query-keys";

export function useCreateApPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createApPayment,
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: apKeys.all }),
      ]);
    },
  });
}
