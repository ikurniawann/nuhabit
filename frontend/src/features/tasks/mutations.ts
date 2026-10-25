"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { createTask, deleteAttachment, occurrenceAction, patchTask, uploadAttachment } from "./api";
import { kpiQueryKeys } from "@/features/hris/kpi/query-keys";
import { taskKeys } from "./query-keys";
import type { CreateTaskPayload, OccurrenceAction, TaskPatch } from "./types";

const fail = (fallback: string) => (error: unknown) => toast.error(error instanceof Error ? error.message : fallback);

/** Halaman Task Departemen lama membaca tabel yang sama: segarkan keduanya. */
function useInvalidateTasks() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: taskKeys.all });
    void qc.invalidateQueries({ queryKey: kpiQueryKeys.all });
  };
}

export function useCreateTask() {
  const invalidate = useInvalidateTasks();
  return useMutation({
    mutationFn: (payload: CreateTaskPayload) => createTask(payload),
    onSuccess: invalidate,
    onError: fail("Tugas gagal dibuat"),
  });
}

export function usePatchTask() {
  const invalidate = useInvalidateTasks();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: TaskPatch }) => patchTask(id, patch),
    onSuccess: invalidate,
    onError: fail("Tugas gagal diperbarui"),
  });
}

/** Aksi pada satu kemunculan: mulai, progres, selesai, review, komentar, ceklis. */
export function useOccurrenceAction() {
  const invalidate = useInvalidateTasks();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: OccurrenceAction }) => occurrenceAction(id, body),
    onSuccess: invalidate,
    onError: fail("Aksi gagal"),
  });
}

export function useAttachments(occurrenceId: string) {
  const invalidate = useInvalidateTasks();
  return {
    upload: useMutation({
      mutationFn: (file: File) => uploadAttachment(occurrenceId, file),
      onSuccess: invalidate,
      onError: fail("Lampiran gagal diunggah"),
    }),
    remove: useMutation({
      mutationFn: (attachmentId: string) => deleteAttachment(occurrenceId, attachmentId),
      onSuccess: invalidate,
      onError: fail("Lampiran gagal dihapus"),
    }),
  };
}
