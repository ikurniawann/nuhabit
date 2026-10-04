"use client";

import { useQuery } from "@tanstack/react-query";
import { getCrmDashboard } from "./api";
import { dashboardQueryKeys } from "./query-keys";

export const useCrmDashboard = () =>
  useQuery({
    queryKey: dashboardQueryKeys.summary(),
    queryFn: getCrmDashboard,
  });
