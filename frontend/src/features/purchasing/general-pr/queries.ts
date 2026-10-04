"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import type { GeneralPRListParams } from "./types";
import {
  getGeneralPRFormData,
  getGeneralPurchaseRequest,
  listGeneralPurchaseRequests,
} from "./api";
import { generalPrQueryKeys } from "./query-keys";

export const useGeneralPurchaseRequestList = (params: GeneralPRListParams) =>
  useQuery({
    queryKey: generalPrQueryKeys.list(params),
    queryFn: () => listGeneralPurchaseRequests(params),
    placeholderData: keepPreviousData,
  });

export const useGeneralPRFormData = () =>
  useQuery({
    queryKey: generalPrQueryKeys.formData(),
    queryFn: getGeneralPRFormData,
  });

export const useGeneralPurchaseRequest = (id: string | null) =>
  useQuery({
    queryKey: generalPrQueryKeys.detail(id ?? ""),
    queryFn: () => getGeneralPurchaseRequest(id!),
    enabled: !!id,
    retry: false,
  });
