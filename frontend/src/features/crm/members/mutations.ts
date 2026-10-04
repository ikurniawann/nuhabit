"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  enrollMember,
  updateMember,
  equipAvatar,
  grantAvatar,
} from "./api";
import { membersQueryKeys } from "./query-keys";
import type { UpdateMemberPayload } from "./types";

export const useEnrollMember = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ customerId, metadata }: { customerId: string; metadata?: Record<string, unknown> }) =>
      enrollMember(customerId, metadata),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: membersQueryKeys.all });
    },
  });
};

export const useUpdateMember = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateMemberPayload }) =>
      updateMember(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: membersQueryKeys.all });
    },
  });
};

// useCreateRedemption & useRedeemAvatar dihapus (EPIC-011): alur redeem
// dengan potong XP pensiun — XP lifetime tidak pernah berkurang.

export const useEquipAvatar = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ memberId, inventoryId }: { memberId: string; inventoryId: string }) =>
      equipAvatar(memberId, inventoryId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: membersQueryKeys.all });
    },
  });
};

export const useGrantAvatar = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      member_id: string;
      avatar_id: string;
      acquisition_source: "manual" | "campaign" | "partner";
      equip: boolean;
    }) => grantAvatar(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: membersQueryKeys.all });
    },
  });
};
