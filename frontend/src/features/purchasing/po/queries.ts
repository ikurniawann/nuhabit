"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import type { POListParams } from "@/types/purchasing";
import { listPurchaseOrders, getPurchaseOrder, getPurchaseOrderPaymentTerms, getPOFormData } from "./api";
import { poQueryKeys } from "./query-keys";

export const usePurchaseOrderList = (params: POListParams, enabled = true) =>
  useQuery({
    queryKey: poQueryKeys.list(params),
    queryFn: () => listPurchaseOrders(params),
    placeholderData: keepPreviousData,
    enabled,
  });

export const usePurchaseOrder = (id: string) =>
  useQuery({
    queryKey: poQueryKeys.detail(id),
    queryFn: () => getPurchaseOrder(id),
    enabled: !!id,
  });

export const usePurchaseOrderPayments = (id: string) =>
  useQuery({
    queryKey: poQueryKeys.payments(id),
    queryFn: () => getPurchaseOrderPaymentTerms(id),
    enabled: !!id,
  });

export const usePOFormData = () =>
  useQuery({
    queryKey: poQueryKeys.formData,
    queryFn: getPOFormData,
  });
