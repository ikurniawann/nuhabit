"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import type { ProductPRListParams } from "./types";
import {
  getProductPRFormData,
  getProductPurchaseRequest,
  listProductPurchaseRequests,
} from "./api";
import { productPrQueryKeys } from "./query-keys";

export const useProductPurchaseRequestList = (params: ProductPRListParams) =>
  useQuery({
    queryKey: productPrQueryKeys.list(params),
    queryFn: () => listProductPurchaseRequests(params),
    placeholderData: keepPreviousData,
  });

export const useProductPRFormData = () =>
  useQuery({
    queryKey: productPrQueryKeys.formData(),
    queryFn: getProductPRFormData,
  });

export const useProductPurchaseRequest = (id: string | null) =>
  useQuery({
    queryKey: productPrQueryKeys.detail(id ?? ""),
    queryFn: () => getProductPurchaseRequest(id!),
    enabled: !!id,
    retry: false,
  });
