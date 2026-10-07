import { apiGet, apiPost, apiPut, apiDelete, buildListUrl } from "@/lib/api-client";
import type {
  FiscalYearItem,
  FiscalYearListFilters,
  FiscalYearPayload,
} from "@/lib/accounting/types";
import type {
  FiscalCoverageResult,
  ResolvedFiscalPeriod,
} from "@/lib/accounting/fiscal-types";

const BASE = "/api/accounting/fiscal-years";

export const fetchFiscalYearList = (filters?: FiscalYearListFilters) =>
  apiGet<{ data: FiscalYearItem[] }>(
    buildListUrl(
      BASE,
      filters as Record<string, string | number | boolean | null | undefined>
    )
  ).then((res) => res.data);

export const fetchFiscalYear = (id: string) =>
  apiGet<{ data: FiscalYearItem }>(`${BASE}/${id}`).then((res) => res.data);

export const fetchFiscalCoverage = (date?: string) =>
  apiGet<{ data: FiscalCoverageResult }>(
    buildListUrl(BASE, {
      coverage: 1,
      date: date || undefined,
    })
  ).then((res) => res.data);

export const openFiscalPeriod = (
  periodId: string,
  opts?: { close_previous?: boolean }
) =>
  apiPost<{ data: ResolvedFiscalPeriod; message?: string }>(
    `/api/accounting/fiscal-periods/${periodId}/open`,
    { close_previous: opts?.close_previous ?? true }
  );

export const createFiscalYear = (body: FiscalYearPayload) =>
  apiPost<{ data: FiscalYearItem; message?: string }>(BASE, body);

export const updateFiscalYear = (id: string, body: FiscalYearPayload) =>
  apiPut<{ data: FiscalYearItem; message?: string }>(`${BASE}/${id}`, body);

export const deleteFiscalYear = (id: string) => apiDelete(`${BASE}/${id}`);
