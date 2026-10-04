"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { journalMappingQueryKeys } from "./query-keys";
import {
  createJournalMapping,
  updateJournalMapping,
  deleteJournalMapping,
} from "./api";
import type { JournalMappingPayload } from "@/lib/accounting/types";

function useInvalidate() {
  const qc = useQueryClient();
  return () =>
    qc.invalidateQueries({ queryKey: journalMappingQueryKeys.all });
}

export function useCreateJournalMapping() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (payload: JournalMappingPayload) =>
      createJournalMapping(payload),
    onSuccess: invalidate,
  });
}

export function useUpdateJournalMapping() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({
      id,
      ...payload
    }: JournalMappingPayload & { id: string }) =>
      updateJournalMapping(id, payload),
    onSuccess: invalidate,
  });
}

export function useDeleteJournalMapping() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => deleteJournalMapping(id),
    onSuccess: invalidate,
  });
}
