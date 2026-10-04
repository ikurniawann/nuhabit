"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { talentPoolQueryKeys } from "./query-keys";
import { updateCandidateStatus, sendCandidateNotification } from "./api";
import type { SendCandidateNotificationPayload } from "./types";

function useInvalidateTalentPool() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: talentPoolQueryKeys.all });
}

export function useUpdateCandidateStatus() {
  const invalidate = useInvalidateTalentPool();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      updateCandidateStatus(id, status),
    onSuccess: invalidate,
  });
}

export function useSendCandidateNotification() {
  const invalidate = useInvalidateTalentPool();
  return useMutation({
    mutationFn: (payload: SendCandidateNotificationPayload) =>
      sendCandidateNotification(payload),
    onSuccess: invalidate,
  });
}
