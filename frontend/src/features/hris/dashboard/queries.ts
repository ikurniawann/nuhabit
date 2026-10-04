"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { dashboardQueryKeys } from "./query-keys";
import { fetchActiveBrands } from "../candidates/api";
import { fetchDashboardData } from "./api";

export const useDashboardBrands = () =>
  useQuery({
    queryKey: dashboardQueryKeys.brands(),
    queryFn: fetchActiveBrands,
  });

export const useDashboardData = (brandFilter: string, period: string) =>
  useQuery({
    queryKey: dashboardQueryKeys.data(brandFilter, period),
    queryFn: () => fetchDashboardData(brandFilter, period),
    placeholderData: keepPreviousData,
  });
