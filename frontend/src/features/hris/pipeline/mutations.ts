"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { pipelineQueryKeys } from "./query-keys";
import { candidatesQueryKeys } from "@/features/hris/candidates/query-keys";
import {
  updateCandidateStage,
  addCandidateNote,
  runCandidateAiAnalysis,
  saveCandidateScreening,
  logWaTemplateActivity,
  createPsikotesSession,
  createInterviewSession,
  createCandidateOffer,
  recordOfferResponse,
  savePsikotesSummary,
  reviewPsikotesTest,
  requestPsikotesAiInsight,
} from "./api";
import type {
  Candidate,
  CandidateNote,
  CandidatePsikotesData,
  OfferCreatePayload,
  OfferResponseStatus,
  PsikotesSummaryPayload,
  ScreeningPayload,
  UpdateCandidateStagePayload,
  WaTemplateKey,
} from "./types";

export function useUpdateCandidateStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: UpdateCandidateStagePayload) =>
      updateCandidateStage(id, status),
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: pipelineQueryKeys.candidates() });
      const previous = qc.getQueryData<Candidate[]>(pipelineQueryKeys.candidates());
      qc.setQueryData<Candidate[]>(pipelineQueryKeys.candidates(), (old) =>
        (old ?? []).map((c) =>
          c.id === id
            ? { ...c, status, updated_at: new Date().toISOString() }
            : c
        )
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        qc.setQueryData(pipelineQueryKeys.candidates(), context.previous);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: pipelineQueryKeys.candidates() });
    },
  });
}

export function useAddCandidateNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, content }: { id: string; content: string }) =>
      addCandidateNote(id, content),
    onSuccess: (note, { id }) => {
      qc.setQueryData<CandidateNote[]>(pipelineQueryKeys.notes(id), (old) => [
        note,
        ...(old ?? []),
      ]);
    },
  });
}

export function useSaveCandidateScreening() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: ScreeningPayload }) =>
      saveCandidateScreening(id, payload),
    onSuccess: (screening, { id }) => {
      qc.setQueryData(pipelineQueryKeys.screening(id), screening);
      // timeline Aktivitas di halaman detail ikut segar (jejak "screening_updated")
      qc.invalidateQueries({ queryKey: candidatesQueryKeys.detail(id) });
    },
  });
}

export function useCreatePsikotesSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload: { instrument_ids: string[]; expires_days: number };
    }) => createPsikotesSession(id, payload),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: pipelineQueryKeys.psikotes(id) });
      qc.invalidateQueries({ queryKey: candidatesQueryKeys.detail(id) });
    },
  });
}

export function useSavePsikotesSummary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: PsikotesSummaryPayload }) =>
      savePsikotesSummary(id, payload),
    onSuccess: (saved, { id }) => {
      // tulis cache sinkron dulu (pola useSaveCandidateScreening) supaya gate
      // "Lolos → Interview" tidak flicker menunggu refetch
      qc.setQueryData<CandidatePsikotesData>(pipelineQueryKeys.psikotes(id), (old) =>
        old ? { ...old, summary: saved } : old
      );
      qc.invalidateQueries({ queryKey: candidatesQueryKeys.detail(id) });
    },
  });
}

export function useRequestPsikotesAiInsight() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      testId,
      observation,
    }: {
      testId: string;
      candidateId: string;
      observation?: string;
    }) => requestPsikotesAiInsight(testId, observation),
    onSuccess: (_data, { candidateId }) => {
      qc.invalidateQueries({ queryKey: pipelineQueryKeys.psikotes(candidateId) });
    },
  });
}

export function useReviewPsikotesTest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      testId,
      reviewNotes,
    }: {
      testId: string;
      candidateId: string;
      reviewNotes: string;
    }) => reviewPsikotesTest(testId, reviewNotes),
    onSuccess: (_data, { candidateId }) => {
      qc.invalidateQueries({ queryKey: pipelineQueryKeys.psikotes(candidateId) });
      qc.invalidateQueries({ queryKey: candidatesQueryKeys.detail(candidateId) });
    },
  });
}

export function useCreateInterviewSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload: { expires_days: number; max_questions: number };
    }) => createInterviewSession(id, payload),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: pipelineQueryKeys.interview(id) });
      qc.invalidateQueries({ queryKey: candidatesQueryKeys.detail(id) });
    },
  });
}

export function useCreateOffer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload: OfferCreatePayload;
    }) => createCandidateOffer(id, payload),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: pipelineQueryKeys.offers(id) });
      qc.invalidateQueries({ queryKey: candidatesQueryKeys.detail(id) });
    },
  });
}

export function useRecordOfferResponse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      offerId,
      payload,
    }: {
      offerId: string;
      candidateId: string;
      payload: { status: OfferResponseStatus; note?: string | null };
    }) => recordOfferResponse(offerId, payload),
    onSuccess: (_data, { candidateId }) => {
      qc.invalidateQueries({ queryKey: pipelineQueryKeys.offers(candidateId) });
      qc.invalidateQueries({ queryKey: candidatesQueryKeys.detail(candidateId) });
    },
  });
}

export function useLogWaTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, template }: { id: string; template: WaTemplateKey }) =>
      logWaTemplateActivity(id, template),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: candidatesQueryKeys.detail(id) });
    },
  });
}

export function useRunAiAnalysis() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (candidateId: string) => runCandidateAiAnalysis(candidateId),
    onSuccess: (data, candidateId) => {
      qc.setQueryData(pipelineQueryKeys.aiAnalysis(candidateId), data);
    },
  });
}
