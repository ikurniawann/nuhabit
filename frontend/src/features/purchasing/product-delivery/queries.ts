"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import type { ProductDeliveryListParams } from "./types";
import {
  getProductDelivery,
  listProductDeliveries,
  listProductDeliveryPOOptions,
  listProductPOItemsForDelivery,
} from "./api";
import { productDeliveryQueryKeys } from "./query-keys";

export function useProductDeliveryList(params: ProductDeliveryListParams) {
  return useQuery({
    queryKey: productDeliveryQueryKeys.list(params),
    queryFn: () => listProductDeliveries(params),
    placeholderData: keepPreviousData,
  });
}

export function useProductDelivery(id: string) {
  return useQuery({
    queryKey: productDeliveryQueryKeys.detail(id),
    queryFn: () => getProductDelivery(id),
    enabled: !!id,
    retry: false,
  });
}

export function useProductDeliveryPOOptions(includeCancelled = false) {
  return useQuery({
    queryKey: productDeliveryQueryKeys.poOptions(includeCancelled),
    queryFn: () => listProductDeliveryPOOptions(includeCancelled),
  });
}

export function useProductPOItemsForDelivery(poId: string) {
  return useQuery({
    queryKey: productDeliveryQueryKeys.poItems(poId),
    queryFn: () => listProductPOItemsForDelivery(poId),
    enabled: !!poId,
  });
}
