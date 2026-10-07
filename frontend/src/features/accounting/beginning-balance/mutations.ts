"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { beginningBalanceQueryKeys } from "./query-keys";
import { fiscalYearQueryKeys } from "@/features/accounting/fiscal-years/query-keys";
import { journalEntryQueryKeys } from "@/features/accounting/journal-entries/query-keys";
import { saveBeginningBalanceApi } from "./api";
import type { BeginningBalanceSavePayload } from "@/lib/accounting/types";

export function useSaveBeginningBalance(fiscalYearId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: BeginningBalanceSavePayload) =>
      saveBeginningBalanceApi(fiscalYearId, payload),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: beginningBalanceQueryKeys.detail(fiscalYearId),
      });
      void qc.invalidateQueries({ queryKey: fiscalYearQueryKeys.all });
      void qc.invalidateQueries({ queryKey: journalEntryQueryKeys.all });
    },
  });
}
