"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { fiscalYearQueryKeys } from "@/features/accounting/fiscal-years/query-keys";
import { closeFiscalPeriodApi, openFiscalPeriodApi } from "./api";
import { periodQueryKeys } from "./query-keys";

function useInvalidatePeriods() {
  const qc = useQueryClient();
  return async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: periodQueryKeys.all }),
      qc.invalidateQueries({ queryKey: fiscalYearQueryKeys.all }),
    ]);
  };
}

export function useOpenAccountingPeriod() {
  const invalidate = useInvalidatePeriods();
  return useMutation({
    mutationFn: ({
      periodId,
      close_previous,
    }: {
      periodId: string;
      close_previous?: boolean;
    }) => openFiscalPeriodApi(periodId, { close_previous }),
    onSuccess: invalidate,
  });
}

export function useCloseAccountingPeriod() {
  const invalidate = useInvalidatePeriods();
  return useMutation({
    mutationFn: (periodId: string) => closeFiscalPeriodApi(periodId),
    onSuccess: invalidate,
  });
}
