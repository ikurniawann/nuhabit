"use client";

import { useQuery } from "@tanstack/react-query";
import { psikotesQueryKeys } from "./query-keys";
import { fetchInstruments, fetchQuestions } from "./api";

export const usePsikotesInstruments = (enabled: boolean = true) =>
  useQuery({
    queryKey: psikotesQueryKeys.instruments(),
    queryFn: fetchInstruments,
    enabled,
  });

export const usePsikotesQuestions = (instrumentId: string | null) =>
  useQuery({
    queryKey: psikotesQueryKeys.questions(instrumentId ?? ""),
    queryFn: () => fetchQuestions(instrumentId as string),
    enabled: Boolean(instrumentId),
  });
