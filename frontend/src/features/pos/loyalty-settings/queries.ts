"use client";

import { useQuery } from "@tanstack/react-query";
import { DEFAULT_POS_LOYALTY_SETTINGS } from "@/lib/pos/loyalty-settings";
import { fetchLoyaltySettings } from "./api";
import { loyaltySettingsQueryKeys } from "./query-keys";

export function useLoyaltySettings(enabled = true) {
  return useQuery({
    queryKey: loyaltySettingsQueryKeys.detail(),
    queryFn: fetchLoyaltySettings,
    enabled,
    staleTime: 60_000,
    placeholderData: DEFAULT_POS_LOYALTY_SETTINGS,
  });
}
