"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createArReceipt } from "./api";
import { arKeys } from "./query-keys";

export function useCreateArReceipt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createArReceipt,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: arKeys.all });
    },
  });
}
