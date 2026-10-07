"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  createCampaign,
  createSingleCode,
  deleteCode,
  fetchCampaigns,
  fetchCodes,
  fetchRedemptions,
  generateBatchCodes,
  toggleCode,
  updateCampaign,
  updateCode,
} from "./api";
import type { PromoCampaignFormValues } from "./types";

export const promoQueryKeys = {
  campaigns: ["promo", "campaigns"] as const,
  codes: (campaignId: string) => ["promo", "codes", campaignId] as const,
  redemptions: (campaignId: string) =>
    ["promo", "redemptions", campaignId] as const,
};

export const useCampaigns = () =>
  useQuery({ queryKey: promoQueryKeys.campaigns, queryFn: fetchCampaigns });

export const usePromoCodes = (campaignId: string | null) =>
  useQuery({
    queryKey: promoQueryKeys.codes(campaignId ?? ""),
    queryFn: () => fetchCodes(campaignId!),
    enabled: campaignId !== null,
  });

export const usePromoRedemptions = (campaignId: string | null) =>
  useQuery({
    queryKey: promoQueryKeys.redemptions(campaignId ?? ""),
    queryFn: () => fetchRedemptions(campaignId!),
    enabled: campaignId !== null,
  });

function usePromoMutation<TVariables, TResult = unknown>(
  mutationFn: (variables: TVariables) => Promise<TResult>,
  successMessage: string,
  onSuccess?: (result: TResult) => void | Promise<void>
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: async (result) => {
      toast.success(successMessage);
      await onSuccess?.(result);
      await queryClient.invalidateQueries({ queryKey: ["promo"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export const useCreateCampaign = () =>
  usePromoMutation(
    (values: PromoCampaignFormValues) => createCampaign(values),
    "Campaign promo dibuat"
  );

export const useUpdateCampaign = () =>
  usePromoMutation(
    ({
      id,
      values,
    }: {
      id: string;
      values: Partial<PromoCampaignFormValues> & { is_active?: boolean; show_in_member_portal?: boolean };
    }) => updateCampaign(id, values),
    "Campaign diperbarui"
  );

export const useCreateSingleCode = (onSuccess?: () => void) =>
  usePromoMutation(
    ({
      campaignId,
      code,
      usageLimit,
    }: {
      campaignId: string;
      code: string;
      usageLimit: number | null;
    }) => createSingleCode(campaignId, code, usageLimit),
    "Kode ditambahkan",
    onSuccess
  );

export const useGenerateBatch = (
  onSuccess?: (result: { count: number; codes: string[] }) => void
) =>
  usePromoMutation(
    ({
      campaignId,
      prefix,
      count,
    }: {
      campaignId: string;
      prefix: string;
      count: number;
    }) => generateBatchCodes(campaignId, prefix, count),
    "Voucher berhasil dibuat",
    onSuccess
  );

export const useToggleCode = () =>
  usePromoMutation(
    ({ id, isActive }: { id: string; isActive: boolean }) =>
      toggleCode(id, isActive),
    "Kode diperbarui"
  );

export const useUpdateCode = (onSuccess?: () => void) =>
  usePromoMutation(
    ({
      id,
      values,
    }: {
      id: string;
      values: { code?: string; usage_limit?: number | null; is_active?: boolean };
    }) => updateCode(id, values),
    "Kode diperbarui",
    onSuccess
  );

export const useDeleteCode = () =>
  usePromoMutation(
    ({ id }: { id: string }) => deleteCode(id),
    "Kode dihapus"
  );
