"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchExecutiveDashboard } from "./api";

const REFRESH_MS = 60_000;

export const executiveDashboardKey = ["dashboard", "executive"] as const;

/** Muat ulang tiap 60 detik selama tab terlihat (React Query menahan interval di tab latar). */
export function useExecutiveDashboard() {
  return useQuery({
    queryKey: executiveDashboardKey,
    queryFn: fetchExecutiveDashboard,
    refetchInterval: REFRESH_MS,
    retry: 1,
  });
}
