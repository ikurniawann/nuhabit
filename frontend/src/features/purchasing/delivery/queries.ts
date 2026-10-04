"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import type { DeliveryListParams } from "./types";
import { listDeliveries, getDelivery, listDeliveryPOOptions } from "./api";
import { listPOItems } from "@/lib/purchasing/api-client/purchase-orders";
import { deliveryQueryKeys } from "./query-keys";

export const useDeliveryList = (params: DeliveryListParams) =>
  useQuery({
    queryKey: deliveryQueryKeys.list(params),
    queryFn: () => listDeliveries(params),
    placeholderData: keepPreviousData,
  });

export const useDelivery = (id: string) =>
  useQuery({
    queryKey: deliveryQueryKeys.detail(id),
    queryFn: () => getDelivery(id),
    enabled: !!id,
    retry: false,
  });

export const useDeliveryPOOptions = (includeCancelled = false) =>
  useQuery({
    queryKey: deliveryQueryKeys.poOptions(includeCancelled),
    queryFn: () => listDeliveryPOOptions(includeCancelled),
  });

export const usePOItemsForDelivery = (poId: string) =>
  useQuery({
    queryKey: deliveryQueryKeys.poItems(poId),
    queryFn: () => listPOItems(poId),
    enabled: !!poId,
  });
