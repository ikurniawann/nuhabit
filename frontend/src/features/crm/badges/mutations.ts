"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { buildBadgePayload, deleteBadge, saveBadge } from "./api";
import { badgesQueryKeys } from "./query-keys";
import type { Badge, SaveBadgePayload } from "./types";

export const useSaveBadge = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: SaveBadgePayload) => saveBadge(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: badgesQueryKeys.all });
    },
  });
};

export const useToggleBadge = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (badge: Badge) =>
      saveBadge(buildBadgePayload(badge, { is_active: !badge.is_active })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: badgesQueryKeys.all });
    },
  });
};

export const useDeleteBadge = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteBadge(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: badgesQueryKeys.all });
    },
  });
};
