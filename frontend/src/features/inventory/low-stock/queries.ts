"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { listLowStock } from "./api";
import { lowStockQueryKeys } from "./query-keys";
import type { LowStockParams } from "./types";

export const useLowStock = (params: LowStockParams) =>
  useQuery({
    queryKey: lowStockQueryKeys.list(params),
    queryFn: () => listLowStock(params),
    placeholderData: keepPreviousData,
  });
