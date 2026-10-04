"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  adjustGiftCard,
  fetchGiftCardConfig,
  fetchGiftCardLedger,
  fetchGiftCards,
  issueGiftCard,
  linkGiftCardMember,
  reloadGiftCard,
  saveGiftCardConfig,
  toggleGiftCard,
} from "./gift-card-api";
import type {
  GiftCard,
  GiftCardConfigValues,
  GiftCardIssueValues,
  GiftCardReloadValues,
} from "./gift-card-types";

type GiftCardListParams = { status?: string; q?: string; phone?: string };

export const giftCardQueryKeys = {
  list: (params?: GiftCardListParams) =>
    ["giftcard", "list", params ?? {}] as const,
  ledger: (id: string) => ["giftcard", "ledger", id] as const,
  config: () => ["giftcard", "config"] as const,
};

export const useGiftCards = (params?: GiftCardListParams) =>
  useQuery({
    queryKey: giftCardQueryKeys.list(params),
    queryFn: () => fetchGiftCards(params),
  });

export const useGiftCardLedger = (id: string | null) =>
  useQuery({
    queryKey: giftCardQueryKeys.ledger(id ?? ""),
    queryFn: () => fetchGiftCardLedger(id!),
    enabled: id !== null,
  });

function useGiftCardMutation<TVariables, TResult = unknown>(
  mutationFn: (variables: TVariables) => Promise<TResult>,
  successMessage: string,
  onSuccess?: (result: TResult) => void
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (result) => {
      toast.success(successMessage);
      queryClient.invalidateQueries({ queryKey: ["giftcard"] });
      onSuccess?.(result);
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export const useIssueGiftCard = (
  onSuccess?: (result: GiftCard | { count: number; codes: string[] }) => void
) =>
  useGiftCardMutation(
    (values: GiftCardIssueValues) => issueGiftCard(values),
    "Gift card diterbitkan",
    onSuccess
  );

export const useGiftCardConfig = () =>
  useQuery({
    queryKey: giftCardQueryKeys.config(),
    queryFn: fetchGiftCardConfig,
  });

export const useSaveGiftCardConfig = () =>
  useGiftCardMutation(
    (values: Partial<GiftCardConfigValues>) => saveGiftCardConfig(values),
    "Konfigurasi gift card tersimpan"
  );

/** Koreksi saldo ber-audit — delta bertanda, alasan wajib (EPIC-034 Fase C). */
export const useAdjustGiftCard = (onSuccess?: () => void) =>
  useGiftCardMutation(
    ({ id, delta, reason }: { id: string; delta: number; reason: string }) =>
      adjustGiftCard(id, delta, reason),
    "Saldo gift card dikoreksi",
    onSuccess
  );

export const useToggleGiftCard = () =>
  useGiftCardMutation(
    ({ id, isActive }: { id: string; isActive: boolean }) =>
      toggleGiftCard(id, isActive),
    "Gift card diperbarui"
  );

export const useReloadGiftCard = (onSuccess?: () => void) =>
  useGiftCardMutation(
    ({ id, values }: { id: string; values: GiftCardReloadValues }) =>
      reloadGiftCard(id, values),
    "Saldo gift card bertambah",
    onSuccess
  );

export const useLinkGiftCardMember = (onSuccess?: () => void) =>
  useGiftCardMutation(
    ({ id, customerId }: { id: string; customerId: string | null }) =>
      linkGiftCardMember(id, customerId),
    "Tautan member diperbarui",
    onSuccess
  );
