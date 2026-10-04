"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { candidatesQueryKeys } from "./query-keys";
import { fetchCandidateList, fetchActiveBrands, fetchCandidateDetail } from "./api";
import type { CandidateListParams } from "./types";

export const useCandidateList = (params: CandidateListParams) =>
  useQuery({
    queryKey: candidatesQueryKeys.list(params),
    queryFn: () => fetchCandidateList(params),
    placeholderData: keepPreviousData,
  });

export const useCandidateBrands = () =>
  useQuery({
    queryKey: candidatesQueryKeys.brands(),
    queryFn: fetchActiveBrands,
  });

export const useCandidateDetail = (id: string) =>
  useQuery({
    queryKey: candidatesQueryKeys.detail(id),
    queryFn: () => fetchCandidateDetail(id),
    enabled: !!id,
  });
