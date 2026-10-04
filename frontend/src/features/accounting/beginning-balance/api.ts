import { apiGet, apiPost } from "@/lib/api-client";
import type {
  BeginningBalanceSavePayload,
  BeginningBalanceSuggestion,
} from "@/lib/accounting/types";

export const fetchBeginningBalance = (fiscalYearId: string) =>
  apiGet<{ data: BeginningBalanceSuggestion }>(
    `/api/accounting/fiscal-years/${fiscalYearId}/beginning-balance`,
  ).then((res) => res.data);

export const saveBeginningBalanceApi = (
  fiscalYearId: string,
  body: BeginningBalanceSavePayload,
) =>
  apiPost<{
    data: { entry_id: string; status: string };
    message?: string;
  }>(`/api/accounting/fiscal-years/${fiscalYearId}/beginning-balance`, body);
