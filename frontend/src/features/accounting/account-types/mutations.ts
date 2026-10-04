"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { accountTypesQueryKeys } from "./query-keys";
import {
  createAccountType,
  updateAccountType,
  deleteAccountType,
} from "./api";
import type { AccountTypePayload } from "./types";

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: accountTypesQueryKeys.all });
}

export function useCreateAccountType() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (payload: AccountTypePayload) => createAccountType(payload),
    onSuccess: invalidate,
  });
}

export function useUpdateAccountType() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, ...payload }: AccountTypePayload & { id: string }) =>
      updateAccountType(id, payload),
    onSuccess: invalidate,
  });
}

export function useDeleteAccountType() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => deleteAccountType(id),
    onSuccess: invalidate,
  });
}
