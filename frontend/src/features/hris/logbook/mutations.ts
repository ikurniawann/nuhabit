"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { logbookQueryKeys } from "./query-keys";
import {
  createLogbookTemplate,
  createLogbookEntry,
  updateLogbookItem,
  updateLogbookEntryStatus,
  deleteLogbookEntry,
  deleteLogbookTemplate,
} from "./api";
import type {
  CreateLogbookTemplatePayload,
  CreateLogbookEntryPayload,
  UpdateLogbookItemPayload,
  UpdateLogbookEntryStatusPayload,
} from "./types";

function useInvalidateLogbook() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: logbookQueryKeys.all });
}

export function useCreateLogbookTemplate() {
  const invalidate = useInvalidateLogbook();
  return useMutation({
    mutationFn: (payload: CreateLogbookTemplatePayload) => createLogbookTemplate(payload),
    onSuccess: invalidate,
  });
}

export function useCreateLogbookEntry() {
  const invalidate = useInvalidateLogbook();
  return useMutation({
    mutationFn: (payload: CreateLogbookEntryPayload) => createLogbookEntry(payload),
    onSuccess: invalidate,
  });
}

export function useUpdateLogbookItem() {
  const invalidate = useInvalidateLogbook();
  return useMutation({
    mutationFn: (payload: UpdateLogbookItemPayload) => updateLogbookItem(payload),
    onSuccess: invalidate,
  });
}

export function useUpdateLogbookEntryStatus() {
  const invalidate = useInvalidateLogbook();
  return useMutation({
    mutationFn: (payload: UpdateLogbookEntryStatusPayload) =>
      updateLogbookEntryStatus(payload),
    onSuccess: invalidate,
  });
}

export function useDeleteLogbookEntry() {
  const invalidate = useInvalidateLogbook();
  return useMutation({
    mutationFn: (entryId: string) => deleteLogbookEntry(entryId),
    onSuccess: invalidate,
  });
}

export function useDeleteLogbookTemplate() {
  const invalidate = useInvalidateLogbook();
  return useMutation({
    mutationFn: (templateId: string) => deleteLogbookTemplate(templateId),
    onSuccess: invalidate,
  });
}
