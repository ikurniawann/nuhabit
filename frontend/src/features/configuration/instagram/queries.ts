"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { deleteInstagramConfig, fetchInstagramConfig, saveInstagramConfig } from "./api";

const instagramConfigKey = ["settings", "instagram"] as const;

export const useInstagramConfig = () =>
  useQuery({ queryKey: instagramConfigKey, queryFn: fetchInstagramConfig, staleTime: 0 });

export function useSaveInstagramConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: saveInstagramConfig,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: instagramConfigKey }),
  });
}

export function useDeleteInstagramConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteInstagramConfig,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: instagramConfigKey }),
  });
}
