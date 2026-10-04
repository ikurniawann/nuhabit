"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createCashMovementApi, createCashTransferApi } from "./api";
import { cashBankQueryKeys } from "./query-keys";
import type {
  CashMovementKind,
  CreateCashMovementPayload,
  CreateCashTransferPayload,
} from "./types";

export function useCreateCashMovement(kind: CashMovementKind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateCashMovementPayload) =>
      createCashMovementApi(kind, body),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: cashBankQueryKeys.all }),
      ]);
    },
  });
}

export function useCreateCashTransfer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateCashTransferPayload) =>
      createCashTransferApi(body),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: cashBankQueryKeys.all });
    },
  });
}
