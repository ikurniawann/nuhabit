"use client";

import { useQuery } from "@tanstack/react-query";
import { getPosDashboard } from "./api";
import { dashboardQueryKeys } from "./query-keys";
import type { DashboardPeriod, DashboardRange } from "./types";

export const usePosDashboard = (period: DashboardPeriod, range?: DashboardRange | null) =>
  useQuery({
    queryKey: dashboardQueryKeys.summary(period, range),
    queryFn: () => getPosDashboard(period, range),
  });
