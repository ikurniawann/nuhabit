"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { updateLoyaltySettings } from "./api";
import { loyaltySettingsQueryKeys } from "./query-keys";
import type { UpdateLoyaltySettingsPayload } from "./types";

export function useUpdateLoyaltySettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: UpdateLoyaltySettingsPayload) => updateLoyaltySettings(payload),
    onSuccess: (data) => {
      queryClient.setQueryData(loyaltySettingsQueryKeys.detail(), data);
      toast.success("Loyalty settings saved.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to save settings");
    },
  });
}
