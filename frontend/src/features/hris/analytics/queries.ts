"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { fetchActiveBrands } from "../candidates/api";
import { analyticsQueryKeys } from "./query-keys";
import { fetchAnalyticsView } from "./api";

export const useAnalyticsBrands = () =>
  useQuery({
    queryKey: analyticsQueryKeys.brands(),
    queryFn: fetchActiveBrands,
  });

export const useAnalyticsView = (brandFilter: string, period: string) =>
  useQuery({
    queryKey: analyticsQueryKeys.data(brandFilter, period),
    queryFn: () => fetchAnalyticsView(brandFilter, period),
    placeholderData: keepPreviousData,
  });
