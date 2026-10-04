"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { saveBillingProfile } from "./api";
import { billingSettingsQueryKeys } from "./query-keys";
import type { UpsertBillingProfilePayload } from "./types";

export function useSaveBillingProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: UpsertBillingProfilePayload) => saveBillingProfile(payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: billingSettingsQueryKeys.all });
    },
  });
}
