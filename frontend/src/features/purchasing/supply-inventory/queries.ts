"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import type { SupplyStockListParams } from "./types";
import {
  getSupplyInventoryFormData,
  getSupplyStockDetail,
  listSupplyStock,
  listSupplyUsages,
} from "./api";
import { supplyInventoryKeys } from "./query-keys";

export function useSupplyStockList(params: SupplyStockListParams) {
  return useQuery({
    queryKey: supplyInventoryKeys.list(params),
    queryFn: () => listSupplyStock(params),
    placeholderData: keepPreviousData,
  });
}

export function useSupplyStockDetail(id: string) {
  return useQuery({
    queryKey: supplyInventoryKeys.detail(id),
    queryFn: () => getSupplyStockDetail(id),
    enabled: !!id,
  });
}

export function useSupplyInventoryFormData() {
  return useQuery({
    queryKey: supplyInventoryKeys.formData(),
    queryFn: getSupplyInventoryFormData,
  });
}

export function useSupplyUsageList() {
  return useQuery({
    queryKey: supplyInventoryKeys.usages(),
    queryFn: listSupplyUsages,
  });
}
