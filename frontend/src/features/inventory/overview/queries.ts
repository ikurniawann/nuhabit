"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import {
  listInventory,
  getInventorySummary,
  getInventoryItem,
  listInventoryMovements,
} from "./api";
import { inventoryQueryKeys } from "./query-keys";
import type { InventoryListParams } from "./types";

export const useInventoryList = (params: InventoryListParams) =>
  useQuery({
    queryKey: inventoryQueryKeys.list(params),
    queryFn: () => listInventory(params),
    placeholderData: keepPreviousData,
  });

export const useInventorySummary = () =>
  useQuery({
    queryKey: inventoryQueryKeys.summary,
    queryFn: getInventorySummary,
  });

export const useInventoryItem = (id: string) =>
  useQuery({
    queryKey: inventoryQueryKeys.detail(id),
    queryFn: () => getInventoryItem(id),
    enabled: !!id,
  });

export const useInventoryMovements = (id: string, page: number, limit = 25) =>
  useQuery({
    queryKey: inventoryQueryKeys.movements(id, page, limit),
    queryFn: () => listInventoryMovements(id, page, limit),
    enabled: !!id,
    placeholderData: keepPreviousData,
  });
