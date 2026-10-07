"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { WallpaperItem } from "@/lib/desktop/wallpapers";

const WALLPAPERS_KEY = ["os-desktop", "wallpapers"] as const;

async function wallpaperRequest(input: string, init: RequestInit, fallbackError: string) {
  const res = await fetch(input, init);
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) throw new Error(json?.error ?? fallbackError);
  return json;
}

/**
 * Wallpaper unggahan admin. Publik, jadi pengunjung pun melihat pilihan
 * yang sama; gagal memuat = cukup wallpaper bawaan.
 */
export function useCustomWallpapers(): WallpaperItem[] {
  const { data } = useQuery({
    queryKey: WALLPAPERS_KEY,
    queryFn: async (): Promise<WallpaperItem[]> => {
      const res = await fetch("/api/desktop/wallpapers");
      const json = res.ok ? await res.json() : null;
      return Array.isArray(json?.data) ? json.data.map((item: WallpaperItem) => ({ ...item, custom: true })) : [];
    },
    staleTime: Infinity,
    retry: false,
  });
  return data ?? [];
}

export function useUploadWallpaper(onUploaded: (item: WallpaperItem) => void) {
  const queryClient = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: async (file: File): Promise<WallpaperItem> => {
      const form = new FormData();
      form.append("file", file);
      const json = await wallpaperRequest("/api/desktop/wallpapers", { method: "POST", body: form }, "Upload gagal");
      return { ...(json.data as WallpaperItem), custom: true };
    },
    onSuccess: (item) => {
      queryClient.setQueryData<WallpaperItem[]>(WALLPAPERS_KEY, (prev = []) => [item, ...prev.filter((row) => row.id !== item.id)]);
      onUploaded(item);
    },
  });
}

export function useDeleteWallpaper(onDeleted: (id: string) => void) {
  const queryClient = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: async (id: string) => {
      await wallpaperRequest(`/api/desktop/wallpapers?id=${encodeURIComponent(id)}`, { method: "DELETE" }, "Gagal menghapus");
      return id;
    },
    onSuccess: (id) => {
      queryClient.setQueryData<WallpaperItem[]>(WALLPAPERS_KEY, (prev = []) => prev.filter((row) => row.id !== id));
      onDeleted(id);
    },
  });
}
