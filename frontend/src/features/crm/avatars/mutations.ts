"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { buildAvatarPayload, deleteAvatar, saveAvatar } from "./api";
import { avatarsQueryKeys } from "./query-keys";
import type { Avatar, SaveAvatarPayload } from "./types";

export const useSaveAvatar = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: SaveAvatarPayload) => saveAvatar(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: avatarsQueryKeys.all });
    },
  });
};

export const useToggleAvatar = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (avatar: Avatar) =>
      saveAvatar(buildAvatarPayload(avatar, { is_active: !avatar.is_active })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: avatarsQueryKeys.all });
    },
  });
};

export const useDeleteAvatar = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteAvatar(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: avatarsQueryKeys.all });
    },
  });
};
