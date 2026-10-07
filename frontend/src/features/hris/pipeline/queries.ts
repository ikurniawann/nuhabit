"use client";

import { useQuery } from "@tanstack/react-query";
import { pipelineQueryKeys } from "./query-keys";
import {
  fetchPipelineCandidates,
  fetchPipelineBrands,
  fetchCandidateAiAnalysis,
  fetchCandidateNotes,
  fetchCandidateScreening,
  fetchCandidatePsikotes,
  fetchPsikotesProctorEvents,
  fetchPsikotesTestAnswers,
  fetchCandidateInterview,
  fetchInterviewProctorEvents,
  fetchInterviewRecordings,
  fetchCandidateOffers,
} from "./api";

export const usePipelineCandidates = () =>
  useQuery({
    queryKey: pipelineQueryKeys.candidates(),
    queryFn: fetchPipelineCandidates,
  });

export const usePipelineBrands = () =>
  useQuery({
    queryKey: pipelineQueryKeys.brands(),
    queryFn: fetchPipelineBrands,
  });

export const useCandidateAiAnalysis = (candidateId: string | null) =>
  useQuery({
    queryKey: pipelineQueryKeys.aiAnalysis(candidateId ?? ""),
    queryFn: () => fetchCandidateAiAnalysis(candidateId!),
    enabled: Boolean(candidateId),
  });

export const useCandidateNotes = (candidateId: string | null) =>
  useQuery({
    queryKey: pipelineQueryKeys.notes(candidateId ?? ""),
    queryFn: () => fetchCandidateNotes(candidateId!),
    enabled: Boolean(candidateId),
  });

export const useCandidateScreening = (candidateId: string | null) =>
  useQuery({
    queryKey: pipelineQueryKeys.screening(candidateId ?? ""),
    queryFn: () => fetchCandidateScreening(candidateId!),
    enabled: Boolean(candidateId),
  });

export const useCandidatePsikotes = (candidateId: string | null) =>
  useQuery({
    queryKey: pipelineQueryKeys.psikotes(candidateId ?? ""),
    queryFn: () => fetchCandidatePsikotes(candidateId!),
    enabled: Boolean(candidateId),
  });

export const usePsikotesProctorEvents = (sessionId: string | null) =>
  useQuery({
    queryKey: pipelineQueryKeys.psikotesProctor(sessionId ?? ""),
    queryFn: () => fetchPsikotesProctorEvents(sessionId!),
    enabled: Boolean(sessionId),
  });

/** Rincian soal + jawaban satu tes (MCQ/PAPI) — dipakai dialog detail hasil. */
export const usePsikotesTestAnswers = (testId: string | null) =>
  useQuery({
    queryKey: pipelineQueryKeys.psikotesAnswers(testId ?? ""),
    queryFn: () => fetchPsikotesTestAnswers(testId!),
    enabled: Boolean(testId),
  });

export const useCandidateInterview = (candidateId: string | null) =>
  useQuery({
    queryKey: pipelineQueryKeys.interview(candidateId ?? ""),
    queryFn: () => fetchCandidateInterview(candidateId!),
    enabled: Boolean(candidateId),
    // sesi berjalan diperbarui kandidat dari portal — poll ringan
    refetchInterval: (query) =>
      query.state.data?.sessions.some((s) => s.status === "in_progress") ? 15_000 : false,
  });

export const useInterviewProctorEvents = (sessionId: string | null) =>
  useQuery({
    queryKey: pipelineQueryKeys.interviewProctor(sessionId ?? ""),
    queryFn: () => fetchInterviewProctorEvents(sessionId!),
    enabled: Boolean(sessionId),
  });

/** Daftar rekaman video satu sesi interview — lazy saat bagian dibuka. */
export const useInterviewRecordings = (sessionId: string | null) =>
  useQuery({
    queryKey: pipelineQueryKeys.interviewRecordings(sessionId ?? ""),
    queryFn: () => fetchInterviewRecordings(sessionId!),
    enabled: Boolean(sessionId),
  });

export const useCandidateOffers = (candidateId: string | null) =>
  useQuery({
    queryKey: pipelineQueryKeys.offers(candidateId ?? ""),
    queryFn: () => fetchCandidateOffers(candidateId!),
    enabled: Boolean(candidateId),
    // kandidat merespons dari portal — poll ringan selama masih ada offer terbuka
    refetchInterval: (query) =>
      query.state.data?.offers.some((o) => o.status === "sent" || o.status === "negotiating")
        ? 20_000
        : false,
  });
