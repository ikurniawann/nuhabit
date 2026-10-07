"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  getCrmSettings,
  listCrmTiers,
  listCrmXpRules,
  listPosProductXp,
  saveCrmTier,
  saveCrmXpRule,
  updateCrmSettings,
  updateProductXp,
} from "./api";

export const settingsQueryKeys = {
  all: ["crm", "settings"] as const,
  tiers: ["crm", "settings", "tiers"] as const,
  xpRules: ["crm", "settings", "xp-rules"] as const,
  productXp: ["crm", "settings", "product-xp"] as const,
};

const errorToast = (fallback: string) => (err: unknown) =>
  toast.error(err instanceof Error ? err.message : fallback);

export const useCrmSettings = () => useQuery({ queryKey: settingsQueryKeys.all, queryFn: getCrmSettings });
export const useCrmTiers = () => useQuery({ queryKey: settingsQueryKeys.tiers, queryFn: listCrmTiers });
export const useCrmXpRules = () => useQuery({ queryKey: settingsQueryKeys.xpRules, queryFn: listCrmXpRules });
export const usePosProductXp = () => useQuery({ queryKey: settingsQueryKeys.productXp, queryFn: listPosProductXp });

export function useSaveCrmSettings(onSaved: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateCrmSettings,
    onSuccess: () => {
      toast.success("Konfigurasi loyalty berhasil disimpan");
      void queryClient.invalidateQueries({ queryKey: settingsQueryKeys.all });
      onSaved();
    },
    onError: errorToast("Gagal menyimpan konfigurasi"),
  });
}

export function useSaveCrmTier(onSaved: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: saveCrmTier,
    onSuccess: () => {
      toast.success("Tier berhasil disimpan");
      onSaved();
      void queryClient.invalidateQueries({ queryKey: settingsQueryKeys.tiers });
    },
    onError: errorToast("Gagal menyimpan tier"),
  });
}

export function useSaveCrmXpRule(onSaved: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: saveCrmXpRule,
    onSuccess: () => {
      toast.success("Aturan XP berhasil disimpan");
      onSaved();
      void queryClient.invalidateQueries({ queryKey: settingsQueryKeys.xpRules });
    },
    onError: errorToast("Gagal menyimpan aturan XP"),
  });
}

export function useSaveProductXp(onSaved: (productId: string) => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ productId, xp }: { productId: string; xp: number }) => updateProductXp(productId, xp),
    onSuccess: (_data, variables) => {
      toast.success("XP produk berhasil disimpan");
      onSaved(variables.productId);
      void queryClient.invalidateQueries({ queryKey: settingsQueryKeys.productXp });
    },
    onError: errorToast("Gagal menyimpan XP produk"),
  });
}
