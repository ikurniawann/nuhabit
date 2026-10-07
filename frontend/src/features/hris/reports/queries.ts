"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { reportsQueryKeys } from "./query-keys";
import { fetchHRISReport } from "./api";

export const useHRISReport = (month: number, year: number) =>
  useQuery({
    queryKey: reportsQueryKeys.report(month, year),
    queryFn: () => fetchHRISReport(month, year),
    placeholderData: keepPreviousData,
  });
