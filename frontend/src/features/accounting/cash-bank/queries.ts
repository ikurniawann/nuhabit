"use client";

import { useQuery } from "@tanstack/react-query";
import { cashBankQueryKeys } from "./query-keys";
import {
  fetchCashBankAccounts,
  fetchCashBankLedger,
  fetchCashMovements,
  fetchCashTransfers,
  fetchPostableAccountOptions,
} from "./api";
import type { CashBankLedgerFilters, CashMovementKind } from "./types";

export const useCashBankAccounts = () =>
  useQuery({
    queryKey: cashBankQueryKeys.list(),
    queryFn: fetchCashBankAccounts,
  });

export const useCashBankLedger = (
  accountId: string | null,
  filters?: CashBankLedgerFilters
) =>
  useQuery({
    queryKey: cashBankQueryKeys.ledger(
      accountId ?? "",
      filters as Record<string, string | undefined>
    ),
    queryFn: () => fetchCashBankLedger(accountId!, filters),
    enabled: Boolean(accountId),
  });

export const useCashMovements = (
  kind: CashMovementKind,
  filters?: {
    search?: string;
    date_from?: string;
    date_to?: string;
    limit?: number;
  }
) =>
  useQuery({
    queryKey: cashBankQueryKeys.movements(kind, filters),
    queryFn: () => fetchCashMovements(kind, filters),
  });

export const usePostableAccountOptions = () =>
  useQuery({
    queryKey: cashBankQueryKeys.accountOptions(),
    queryFn: fetchPostableAccountOptions,
  });

export const useCashTransfers = (filters?: {
  search?: string;
  date_from?: string;
  date_to?: string;
  limit?: number;
}) =>
  useQuery({
    queryKey: cashBankQueryKeys.transfers(filters),
    queryFn: () => fetchCashTransfers(filters),
  });
