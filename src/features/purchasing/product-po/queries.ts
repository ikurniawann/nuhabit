"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import type { ProductPOListParams } from "./types";
import {
  getProductPOFormData,
  getProductPurchaseOrder,
  listApprovedProductPRsForPO,
  listProductPurchaseOrders,
} from "./api";
import { productPoQueryKeys } from "./query-keys";

export function useProductPurchaseOrderList(params: ProductPOListParams, enabled = true) {
  return useQuery({
    queryKey: productPoQueryKeys.list(params),
    queryFn: () => listProductPurchaseOrders(params),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useProductPurchaseOrder(id: string) {
  return useQuery({
    queryKey: productPoQueryKeys.detail(id),
    queryFn: () => getProductPurchaseOrder(id),
    enabled: !!id,
  });
}

export function useProductPOFormData() {
  return useQuery({
    queryKey: productPoQueryKeys.formData(),
    queryFn: getProductPOFormData,
  });
}

export function useApprovedProductPRsForPO() {
  return useQuery({
    queryKey: productPoQueryKeys.approvedPRs(),
    queryFn: listApprovedProductPRsForPO,
    staleTime: 0,
    refetchOnMount: "always",
  });
}
