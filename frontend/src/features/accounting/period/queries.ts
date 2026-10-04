"use client";

import { useQuery } from "@tanstack/react-query";
import { periodQueryKeys } from "./query-keys";
import {
  fetchAccountingPeriods,
  fetchPeriodClosePreview,
} from "./api";
import type { AccountingPeriodFilters } from "./types";

export const useAccountingPeriods = (filters?: AccountingPeriodFilters) =>
  useQuery({
    queryKey: periodQueryKeys.list(filters as Record<string, unknown>),
    queryFn: () => fetchAccountingPeriods(filters),
  });

export const usePeriodClosePreview = (periodId: string | null) =>
  useQuery({
    queryKey: periodQueryKeys.closePreview(periodId ?? ""),
    queryFn: () => fetchPeriodClosePreview(periodId!),
    enabled: Boolean(periodId),
  });
