"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet, apiPut } from "@/lib/api-client";
import type { StorefrontConfig } from "@/lib/shop/types";

const settingsKey = ["shop", "storefront-settings"] as const;

export const useStorefrontSettings = () =>
  useQuery({
    queryKey: settingsKey,
    queryFn: () => apiGet<{ data: StorefrontConfig }>("/api/shop/storefront-settings").then((res) => res.data),
  });

/** PUT replaces the whole row, so every field is sent. */
export function useSaveStorefrontSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (settings: StorefrontConfig) =>
      apiPut<{ data: StorefrontConfig }>("/api/shop/storefront-settings", settings).then((res) => res.data),
    onSuccess: (settings) => {
      queryClient.setQueryData(settingsKey, settings);
      toast.success("Pengaturan storefront tersimpan");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Gagal menyimpan"),
  });
}
