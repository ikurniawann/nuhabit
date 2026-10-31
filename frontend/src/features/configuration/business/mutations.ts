"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createBusinessEntity,
  deleteBusinessEntity,
  deleteCompanyLogo,
  saveCompanyProfile,
  uploadCompanyLogo,
  saveReceiptSettings,
  updateBusinessEntity,
  type ReceiptSettingsData,
} from "./api";
import { letterheadQueryKeys } from "@/features/documents";
import { businessQueryKeys } from "./query-keys";
import type {
  CreateBusinessPayload,
  UpdateBusinessPayload,
  BusinessEntityType,
} from "./types";

export const useCreateBusinessEntity = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateBusinessPayload) =>
      createBusinessEntity(payload),
    onSuccess: (res) => {
      queryClient.setQueryData(businessQueryKeys.tree(), res.tree);
    },
  });
};

export const useUpdateBusinessEntity = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      type,
      id,
      payload,
    }: {
      type: BusinessEntityType;
      id: string;
      payload: UpdateBusinessPayload;
    }) => updateBusinessEntity(type, id, payload),
    onSuccess: (res) => {
      queryClient.setQueryData(businessQueryKeys.tree(), res.tree);
    },
  });
};

export const useDeleteBusinessEntity = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ type, id }: { type: BusinessEntityType; id: string }) =>
      deleteBusinessEntity(type, id),
    onSuccess: (res) => {
      queryClient.setQueryData(businessQueryKeys.tree(), res.tree);
    },
  });
};

export const useSaveReceiptSettings = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: saveReceiptSettings,
    onSuccess: (res) => {
      queryClient.setQueryData<ReceiptSettingsData>(
        businessQueryKeys.receipt(),
        (prev) => (prev ? { ...prev, data: res.data ?? [] } : prev),
      );
    },
  });
};

/** Profil perusahaan juga kop quotation dan invoice: segarkan keduanya. */
function useProfileMutation<T>(mutationFn: (input: T) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: businessQueryKeys.companyProfile() }),
        queryClient.invalidateQueries({ queryKey: letterheadQueryKeys.all }),
      ]),
  });
}

export const useSaveCompanyProfile = () => useProfileMutation(saveCompanyProfile);
export const useUploadCompanyLogo = () => useProfileMutation(uploadCompanyLogo);
export const useDeleteCompanyLogo = () => useProfileMutation<void>(() => deleteCompanyLogo());
