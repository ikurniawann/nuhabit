"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import type { GeneralPOListParams } from "./types";
import {
  getGeneralPOFormData,
  getGeneralPurchaseOrder,
  listApprovedGeneralPRsForPO,
  listGeneralPurchaseOrders,
} from "./api";
import { generalPoQueryKeys } from "./query-keys";

export function useGeneralPurchaseOrderList(params: GeneralPOListParams, enabled = true) {
  return useQuery({
    queryKey: generalPoQueryKeys.list(params),
    queryFn: () => listGeneralPurchaseOrders(params),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useGeneralPurchaseOrder(id: string) {
  return useQuery({
    queryKey: generalPoQueryKeys.detail(id),
    queryFn: () => getGeneralPurchaseOrder(id),
    enabled: !!id,
  });
}

export function useGeneralPOFormData() {
  return useQuery({
    queryKey: generalPoQueryKeys.formData(),
    queryFn: getGeneralPOFormData,
  });
}

export function useApprovedGeneralPRsForPO() {
  return useQuery({
    queryKey: generalPoQueryKeys.approvedPRs(),
    queryFn: listApprovedGeneralPRsForPO,
    staleTime: 0,
    refetchOnMount: "always",
  });
}
