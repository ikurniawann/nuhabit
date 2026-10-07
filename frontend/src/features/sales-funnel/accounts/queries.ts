"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { createAccount, deleteAccount, fetchAccountDetail, fetchAccounts, updateAccount } from "./api";
import type { AccountFilters, AccountFormValues } from "./types";

export const accountQueryKeys = {
  all: ["sales-funnel", "accounts"] as const,
  list: (filters: AccountFilters) => ["sales-funnel", "accounts", filters] as const,
  detail: (id: string) => ["sales-funnel", "accounts", "detail", id] as const,
};

export const useAccounts = (filters: AccountFilters) =>
  useQuery({ queryKey: accountQueryKeys.list(filters), queryFn: () => fetchAccounts(filters) });

export const useAccountDetail = (id: string) =>
  useQuery({
    queryKey: accountQueryKeys.detail(id),
    queryFn: () => fetchAccountDetail(id),
    enabled: id !== "",
  });

export function useCreateAccount(onSuccess?: (id?: string) => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: AccountFormValues) => createAccount(values),
    onSuccess: (body: { data?: { id?: string } }) => {
      toast.success("Account dibuat");
      queryClient.invalidateQueries({ queryKey: accountQueryKeys.all });
      onSuccess?.(body?.data?.id);
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useUpdateAccount(onSuccess?: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id: string; values: Partial<AccountFormValues> }) =>
      updateAccount(id, values),
    onSuccess: () => {
      toast.success("Account diperbarui");
      queryClient.invalidateQueries({ queryKey: accountQueryKeys.all });
      onSuccess?.();
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useDeleteAccount(onSuccess?: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteAccount(id),
    onSuccess: () => {
      toast.success("Account dihapus");
      queryClient.invalidateQueries({ queryKey: accountQueryKeys.all });
      onSuccess?.();
    },
    onError: (error: Error) => toast.error(error.message),
  });
}
