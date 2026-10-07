"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { psikotesQueryKeys } from "./query-keys";
import { updateInstrument, createQuestion, updateQuestion, deleteQuestion } from "./api";
import type { InstrumentUpdatePayload, QuestionPayload } from "./types";

export function useUpdateInstrument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: InstrumentUpdatePayload }) =>
      updateInstrument(id, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: psikotesQueryKeys.instruments() }),
  });
}

function useInvalidateQuestions() {
  const qc = useQueryClient();
  return (instrumentId: string) => {
    qc.invalidateQueries({ queryKey: psikotesQueryKeys.questions(instrumentId) });
    // jumlah soal di kartu instrumen ikut berubah
    qc.invalidateQueries({ queryKey: psikotesQueryKeys.instruments() });
  };
}

export function useCreateQuestion() {
  const invalidate = useInvalidateQuestions();
  return useMutation({
    mutationFn: ({ instrumentId, payload }: { instrumentId: string; payload: QuestionPayload }) =>
      createQuestion(instrumentId, payload),
    onSuccess: (_data, vars) => invalidate(vars.instrumentId),
  });
}

export function useUpdateQuestion() {
  const invalidate = useInvalidateQuestions();
  return useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      instrumentId: string;
      payload: QuestionPayload;
    }) => updateQuestion(id, payload),
    onSuccess: (_data, vars) => invalidate(vars.instrumentId),
  });
}

export function useDeleteQuestion() {
  const invalidate = useInvalidateQuestions();
  return useMutation({
    mutationFn: ({ id }: { id: string; instrumentId: string }) => deleteQuestion(id),
    onSuccess: (_data, vars) => invalidate(vars.instrumentId),
  });
}
