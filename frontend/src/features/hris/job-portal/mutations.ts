"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { jobPortalQueryKeys } from "./query-keys";
import { saveJobOpening, deleteJobOpening } from "./api";
import type { JobOpeningPayload } from "@/lib/recruitment/job-portal-form";

export function useSaveJobOpening() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ payload, id }: { payload: JobOpeningPayload; id?: string }) =>
      saveJobOpening(payload, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: jobPortalQueryKeys.jobs() }),
  });
}

export function useDeleteJobOpening() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteJobOpening(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: jobPortalQueryKeys.jobs() }),
  });
}
