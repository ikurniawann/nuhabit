"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { journalEntryQueryKeys } from "./query-keys";
import {
  createJournalEntry,
  updateJournalEntry,
  deleteJournalEntry,
  postJournalEntryApi,
} from "./api";
import type { JournalEntryPayload } from "@/lib/accounting/types";

function useInvalidate() {
  const qc = useQueryClient();
  return () =>
    qc.invalidateQueries({ queryKey: journalEntryQueryKeys.all });
}

export function useCreateJournalEntry() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (payload: JournalEntryPayload) => createJournalEntry(payload),
    onSuccess: invalidate,
  });
}

export function useUpdateJournalEntry() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({
      id,
      ...payload
    }: JournalEntryPayload & { id: string }) =>
      updateJournalEntry(id, payload),
    onSuccess: invalidate,
  });
}

export function usePostJournalEntry() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => postJournalEntryApi(id),
    onSuccess: invalidate,
  });
}

export function useDeleteJournalEntry() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => deleteJournalEntry(id),
    onSuccess: invalidate,
  });
}
