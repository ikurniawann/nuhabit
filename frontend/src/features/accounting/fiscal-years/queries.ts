"use client";

import { useQuery } from "@tanstack/react-query";
import { fiscalYearQueryKeys } from "./query-keys";
import {
  fetchFiscalYearList,
  fetchFiscalYear,
  fetchFiscalCoverage,
} from "./api";
import type { FiscalYearListFilters } from "@/lib/accounting/types";

export const useFiscalYearList = (filters?: FiscalYearListFilters) =>
  useQuery({
    queryKey: fiscalYearQueryKeys.list(
      filters as Record<string, string | undefined>
    ),
    queryFn: () => fetchFiscalYearList(filters),
  });

export const useFiscalYear = (id: string | null) =>
  useQuery({
    queryKey: fiscalYearQueryKeys.detail(id ?? ""),
    queryFn: () => fetchFiscalYear(id!),
    enabled: Boolean(id),
  });

export const useFiscalCoverage = (date?: string, enabled = true) =>
  useQuery({
    queryKey: fiscalYearQueryKeys.coverage(date),
    queryFn: () => fetchFiscalCoverage(date),
    enabled,
  });
