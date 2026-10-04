"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updatePrintJob } from "./api";
import { printQueueQueryKeys } from "./query-keys";
import type { PrintJobAction } from "./types";

export const useUpdatePrintJob = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, action }: { jobId: string; action: PrintJobAction }) =>
      updatePrintJob(jobId, action),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: printQueueQueryKeys.all });
    },
  });
};
