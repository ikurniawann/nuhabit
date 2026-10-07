"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { buildRewardPayload, claimRedemption, deleteReward, saveReward, updateRedemption } from "./api";
import { redemptionsQueryKeys, rewardsQueryKeys } from "./query-keys";
import type { Reward, SaveRewardPayload } from "./types";

export const useSaveReward = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: SaveRewardPayload) => saveReward(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: rewardsQueryKeys.all });
    },
  });
};

export const useToggleReward = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reward: Reward) =>
      saveReward(buildRewardPayload(reward, { is_active: !reward.is_active })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: rewardsQueryKeys.all });
    },
  });
};

export const useDeleteReward = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteReward(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: rewardsQueryKeys.all });
    },
  });
};

export const useUpdateRedemption = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { id: string; action: "approve" | "fulfill" | "cancel" }) =>
      updateRedemption(payload),
    onSuccess: () => {
      // Stok reward ikut berubah saat approve/cancel, jadi keduanya di-refresh.
      queryClient.invalidateQueries({ queryKey: redemptionsQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: rewardsQueryKeys.all });
    },
  });
};

export const useClaimRedemption = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { customer_id: string; reward_id: string }) =>
      claimRedemption(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: redemptionsQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: rewardsQueryKeys.all });
    },
  });
};
