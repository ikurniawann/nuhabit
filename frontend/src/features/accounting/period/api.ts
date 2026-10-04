import { apiGet, apiPost, buildListUrl } from "@/lib/api-client";
import type {
  AccountingPeriodFilters,
  AccountingPeriodListItem,
  PeriodClosePreview,
  ResolvedFiscalPeriod,
} from "./types";

const BASE = "/api/accounting/fiscal-periods";

export const fetchAccountingPeriods = (filters?: AccountingPeriodFilters) =>
  apiGet<{ data: AccountingPeriodListItem[] }>(
    buildListUrl(BASE, {
      fiscal_year_id: filters?.fiscal_year_id || undefined,
      status: filters?.status || undefined,
      search: filters?.search || undefined,
    } as Record<string, string | undefined>)
  ).then((r) => r.data);

export const fetchPeriodClosePreview = (periodId: string) =>
  apiGet<{ data: PeriodClosePreview }>(`${BASE}/${periodId}/close`).then(
    (r) => r.data
  );

export const closeFiscalPeriodApi = (periodId: string) =>
  apiPost<{ data: ResolvedFiscalPeriod; message?: string }>(
    `${BASE}/${periodId}/close`,
    {}
  );

export const openFiscalPeriodApi = (
  periodId: string,
  opts?: { close_previous?: boolean }
) =>
  apiPost<{ data: ResolvedFiscalPeriod; message?: string }>(
    `${BASE}/${periodId}/open`,
    { close_previous: opts?.close_previous ?? true }
  );
