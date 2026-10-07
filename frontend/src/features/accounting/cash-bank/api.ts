import { apiGet, apiPost, buildListUrl } from "@/lib/api-client";
import type {
  CashBankAccountItem,
  CashBankLedgerFilters,
  CashBankLedgerItem,
  CashMovementItem,
  CashMovementKind,
  CashTransferItem,
  CreateCashMovementPayload,
  CreateCashTransferPayload,
  PostableAccountOptionItem,
} from "./types";

const BASE = "/api/accounting/cash-bank";

export const fetchCashBankAccounts = () =>
  apiGet<{ data: CashBankAccountItem[] }>(BASE).then((res) => res.data);

export const fetchCashBankLedger = (
  accountId: string,
  filters?: CashBankLedgerFilters
) =>
  apiGet<{ data: CashBankLedgerItem }>(
    buildListUrl(
      `${BASE}/${accountId}/ledger`,
      filters as Record<string, string | number | boolean | null | undefined>
    )
  ).then((res) => res.data);

export const fetchCashMovements = (
  kind: CashMovementKind,
  filters?: {
    search?: string;
    date_from?: string;
    date_to?: string;
    limit?: number;
  }
) =>
  apiGet<{ data: CashMovementItem[]; meta?: { total: number } }>(
    buildListUrl(`${BASE}/${kind === "cash_in" ? "cash-in" : "cash-out"}`, {
      ...filters,
    } as Record<string, string | number | undefined>)
  );

export const createCashMovementApi = (
  kind: CashMovementKind,
  body: CreateCashMovementPayload
) =>
  apiPost<{ data: CashMovementItem; message?: string }>(
    `${BASE}/${kind === "cash_in" ? "cash-in" : "cash-out"}`,
    body
  );

export const fetchPostableAccountOptions = () =>
  apiGet<{ data: PostableAccountOptionItem[] }>(
    `${BASE}/accounts-options`
  ).then((r) => r.data);

export const fetchCashTransfers = (filters?: {
  search?: string;
  date_from?: string;
  date_to?: string;
  limit?: number;
}) =>
  apiGet<{ data: CashTransferItem[]; meta?: { total: number } }>(
    buildListUrl(`${BASE}/transfer`, {
      ...filters,
    } as Record<string, string | number | undefined>)
  );

export const createCashTransferApi = (body: CreateCashTransferPayload) =>
  apiPost<{ data: CashTransferItem; message?: string }>(
    `${BASE}/transfer`,
    body
  );
