"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { buildWallpaperPayload, deleteWallpaper, saveWallpaper } from "./api";
import { wallpapersQueryKeys } from "./query-keys";
import type { SaveWallpaperPayload, Wallpaper } from "./types";

export const useSaveWallpaper = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: SaveWallpaperPayload) => saveWallpaper(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: wallpapersQueryKeys.all });
    },
  });
};

export const useToggleWallpaper = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (wallpaper: Wallpaper) =>
      saveWallpaper(buildWallpaperPayload(wallpaper, { is_active: !wallpaper.is_active })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: wallpapersQueryKeys.all });
    },
  });
};

export const useDeleteWallpaper = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteWallpaper(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: wallpapersQueryKeys.all });
    },
  });
};
