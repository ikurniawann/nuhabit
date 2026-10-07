"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import type { PRListParams } from "./types";
import { getPRFormData, getPurchaseRequest, listPurchaseRequests } from "./api";
import { prQueryKeys } from "./query-keys";

export const usePurchaseRequestList = (params: PRListParams) =>
  useQuery({
    queryKey: prQueryKeys.list(params),
    queryFn: () => listPurchaseRequests(params),
    placeholderData: keepPreviousData,
  });

export const usePRFormData = () =>
  useQuery({
    queryKey: prQueryKeys.formData(),
    queryFn: getPRFormData,
  });

export const usePurchaseRequest = (id: string | null) =>
  useQuery({
    queryKey: prQueryKeys.detail(id ?? ""),
    queryFn: () => getPurchaseRequest(id!),
    enabled: !!id,
    retry: false,
  });
