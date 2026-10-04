"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { offboardingQueryKeys } from "./query-keys";
import { initiateOffboarding, updateOffboarding } from "./api";
import type {
  InitiateOffboardingPayload,
  UpdateOffboardingPayload,
} from "./types";

export function useInitiateOffboarding(employeeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: InitiateOffboardingPayload) =>
      initiateOffboarding(employeeId, payload),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: offboardingQueryKeys.record(employeeId) }),
  });
}

export function useUpdateOffboarding(employeeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: UpdateOffboardingPayload) =>
      updateOffboarding(employeeId, payload),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: offboardingQueryKeys.record(employeeId) }),
  });
}
