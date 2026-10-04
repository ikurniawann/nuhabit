import { apiGet, apiPost, buildListUrl } from "@/lib/api-client";
import type { LoanDecision, LoanPayload, LoanRow } from "./types";

/** status "all" = tanpa filter. */
export const fetchLoans = (status: string) =>
  apiGet<{ data: LoanRow[] }>(
    buildListUrl("/api/hris/loans", { status: status === "all" ? undefined : status })
  ).then((res) => res.data ?? []);

export const createLoan = (payload: LoanPayload) =>
  apiPost<{ message?: string }>("/api/hris/loans", payload);

export const decideLoan = ({ id, approved, rejection_reason }: LoanDecision) =>
  apiPost<{ message?: string }>(`/api/hris/loans/${id}/approve`, { approved, rejection_reason });
