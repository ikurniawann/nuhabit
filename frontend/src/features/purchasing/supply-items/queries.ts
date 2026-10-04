"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { listSupplyItems, getSupplyItemFormDeps } from "./api";
import { supplyItemsQueryKeys } from "./query-keys";
import type { SupplyItemListParams } from "./types";

export const useSupplyItemList = (params: SupplyItemListParams) =>
  useQuery({
    queryKey: supplyItemsQueryKeys.list(params),
    queryFn: () => listSupplyItems(params),
    placeholderData: keepPreviousData,
  });

export const useSupplyItemFormDeps = () =>
  useQuery({
    queryKey: supplyItemsQueryKeys.formDeps,
    queryFn: getSupplyItemFormDeps,
  });
