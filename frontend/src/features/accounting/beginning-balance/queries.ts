"use client";

import { useQuery } from "@tanstack/react-query";
import { beginningBalanceQueryKeys } from "./query-keys";
import { fetchBeginningBalance } from "./api";

export const useBeginningBalance = (fiscalYearId: string | null) =>
  useQuery({
    queryKey: beginningBalanceQueryKeys.detail(fiscalYearId ?? ""),
    queryFn: () => fetchBeginningBalance(fiscalYearId!),
    enabled: Boolean(fiscalYearId),
  });
