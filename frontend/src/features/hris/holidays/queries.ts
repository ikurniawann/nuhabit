"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchHolidayImportPreview, fetchHolidays } from "./api";
import { holidayQueryKeys } from "./query-keys";

export const useHolidays = (year: number) =>
  useQuery({ queryKey: holidayQueryKeys.list(year), queryFn: () => fetchHolidays(year) });

/**
 * Pratinjau impor ditarik ulang setiap dialog dibuka (gcTime 0) dan tidak
 * di-refetch selama terbuka, supaya centang HRD tidak ter-reset.
 */
export const useHolidayImportPreview = (year: number) =>
  useQuery({
    queryKey: holidayQueryKeys.importPreview(year),
    queryFn: () => fetchHolidayImportPreview(year),
    gcTime: 0,
    staleTime: Infinity,
    retry: false,
  });
