"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchBillingOptions, resolveBillingProfile } from "./api";
import { billingSettingsQueryKeys } from "./query-keys";

export function useBillingOptions(branchId?: string | null) {
  return useQuery({
    queryKey: billingSettingsQueryKeys.options(branchId),
    queryFn: () => fetchBillingOptions(branchId),
  });
}

export function useResolvedBillingProfile(params: {
  branchId?: string | null;
  warehouseId?: string | null;
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: billingSettingsQueryKeys.resolve(params.branchId, params.warehouseId),
    queryFn: () =>
      resolveBillingProfile({
        branchId: params.branchId,
        warehouseId: params.warehouseId,
      }),
    enabled: params.enabled !== false,
  });
}
