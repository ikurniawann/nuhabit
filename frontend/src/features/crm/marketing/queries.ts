"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { SegmentDefinition } from "@/lib/crm/segments";
import type { PublicFormInput } from "@/lib/crm/public-forms";
import * as api from "./api";

export const K = {
  segments: ["crm", "marketing", "segments"] as const,
  forms: ["crm", "marketing", "forms"] as const,
  submissions: (id: string) => ["crm", "marketing", "submissions", id] as const,
};

function mutation<TArgs>(fn: (args: TArgs) => Promise<unknown>, keys: readonly (readonly string[])[], okMessage: string) {
  return function useIt() {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: fn,
      onSuccess: (body) => {
        const msg = (body as { message?: string } | undefined)?.message;
        toast.success(msg ?? okMessage);
        for (const k of keys) qc.invalidateQueries({ queryKey: k });
      },
      onError: (e: Error) => toast.error(e.message),
    });
  };
}

export const useSegments = () => useQuery({ queryKey: K.segments, queryFn: api.fetchSegments });
export function usePreviewDefinition() {
  return useMutation({
    mutationFn: (definition: SegmentDefinition) => api.previewDefinition(definition),
    onError: (e: Error) => toast.error(e.message),
  });
}
export const useRecountSegment = mutation((id: string) => api.recountSegment(id), [K.segments], "Jumlah anggota diperbarui");
export const useCreateSegment = mutation(
  (v: { name: string; description?: string | null; definition: SegmentDefinition; is_active: boolean }) => api.createSegment(v),
  [K.segments], "Segmen disimpan"
);
export const useUpdateSegment = mutation(
  ({ id, values }: { id: string; values: Partial<{ name: string; description: string | null; definition: SegmentDefinition; is_active: boolean }> }) =>
    api.updateSegment(id, values),
  [K.segments], "Segmen diperbarui"
);
export const useDeleteSegment = mutation((id: string) => api.deleteSegment(id), [K.segments], "Segmen dihapus");

export const useForms = () => useQuery({ queryKey: K.forms, queryFn: api.fetchForms });
export const useFormSubmissions = (id: string | null) =>
  useQuery({ queryKey: K.submissions(id ?? ""), queryFn: () => api.fetchSubmissions(id as string), enabled: Boolean(id) });
export const useCreateForm = mutation((v: PublicFormInput) => api.createForm(v), [K.forms], "Form dibuat");
export const useUpdateForm = mutation(
  ({ id, values }: { id: string; values: Partial<PublicFormInput> }) => api.updateForm(id, values),
  [K.forms], "Form diperbarui"
);
export const useDeleteForm = mutation((id: string) => api.deleteForm(id), [K.forms], "Form dihapus");
