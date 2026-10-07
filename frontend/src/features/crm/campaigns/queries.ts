"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  addOptout,
  campaignAction,
  createCampaign,
  fetchCampaignConfig,
  fetchCampaignReport,
  fetchCampaigns,
  fetchOptouts,
  fetchPromoCampaigns,
  removeOptout,
  updateCampaignConfig,
  type CampaignActionName,
  type CreateCampaignInput,
} from "./api";
import type { CampaignConfig } from "./types";

export const campaignQueryKeys = {
  all: ["crm", "campaigns"] as const,
  list: ["crm", "campaigns", "list"] as const,
  report: (id: string) => ["crm", "campaigns", "report", id] as const,
  config: ["crm", "campaigns", "config"] as const,
  optouts: ["crm", "campaigns", "optouts"] as const,
  promoOptions: ["crm", "campaigns", "promo-options"] as const,
};

export const useCampaigns = () =>
  useQuery({ queryKey: campaignQueryKeys.list, queryFn: fetchCampaigns });

export const useCampaignReport = (id: string | null) =>
  useQuery({
    queryKey: campaignQueryKeys.report(id ?? ""),
    queryFn: () => fetchCampaignReport(id!),
    enabled: id !== null,
  });

export const useCampaignConfig = () =>
  useQuery({ queryKey: campaignQueryKeys.config, queryFn: fetchCampaignConfig });

export const useOptouts = () =>
  useQuery({ queryKey: campaignQueryKeys.optouts, queryFn: fetchOptouts });

export const usePromoOptions = () =>
  useQuery({
    queryKey: campaignQueryKeys.promoOptions,
    queryFn: fetchPromoCampaigns,
  });

function useCampaignMutation<TVariables, TResult = unknown>(
  mutationFn: (variables: TVariables) => Promise<TResult>,
  successMessage: string | null,
  onSuccess?: (result: TResult) => void
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (result) => {
      if (successMessage) toast.success(successMessage);
      queryClient.invalidateQueries({ queryKey: campaignQueryKeys.all });
      onSuccess?.(result);
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export const useCreateCampaign = (onSuccess?: () => void) =>
  useCampaignMutation(
    (values: CreateCampaignInput) => createCampaign(values),
    "Kampanye tersimpan",
    onSuccess
  );

export const useCampaignAction = () =>
  useCampaignMutation(
    ({ id, action, scheduledAt }: { id: string; action: CampaignActionName; scheduledAt?: string }) =>
      campaignAction(id, action, scheduledAt),
    null,
    (result) => toast.success(result.message)
  );

export const useUpdateCampaignConfig = () =>
  useCampaignMutation(
    (values: Partial<CampaignConfig>) => updateCampaignConfig(values),
    "Konfigurasi tersimpan"
  );

export const useAddOptout = (onSuccess?: () => void) =>
  useCampaignMutation(
    ({ phone, note }: { phone: string; note?: string }) => addOptout(phone, note),
    "Nomor masuk daftar opt-out",
    onSuccess
  );

export const useRemoveOptout = () =>
  useCampaignMutation(
    (id: string) => removeOptout(id),
    "Nomor dikeluarkan dari opt-out"
  );
