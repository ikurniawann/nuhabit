"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchStockAlerts } from "./api";
import { stockAlertsQueryKeys } from "./query-keys";

export function useStockAlerts(pollInterval = 15000) {
  const query = useQuery({
    queryKey: stockAlertsQueryKeys.list(),
    queryFn: fetchStockAlerts,
    refetchInterval: pollInterval,
  });

  return {
    data: query.data,
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refresh: query.refetch,
  };
}
