"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { fiscalYearQueryKeys } from "./query-keys";
import {
  createFiscalYear,
  updateFiscalYear,
  deleteFiscalYear,
  openFiscalPeriod,
} from "./api";
import type { FiscalYearPayload } from "@/lib/accounting/types";

function useInvalidate() {
  const qc = useQueryClient();
  return () =>
    qc.invalidateQueries({ queryKey: fiscalYearQueryKeys.all });
}

export function useCreateFiscalYear() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (payload: FiscalYearPayload) => createFiscalYear(payload),
    onSuccess: invalidate,
  });
}

export function useUpdateFiscalYear() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({
      id,
      ...payload
    }: FiscalYearPayload & { id: string }) => updateFiscalYear(id, payload),
    onSuccess: invalidate,
  });
}

export function useDeleteFiscalYear() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => deleteFiscalYear(id),
    onSuccess: invalidate,
  });
}

export function useOpenFiscalPeriod() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({
      periodId,
      close_previous,
    }: {
      periodId: string;
      close_previous?: boolean;
    }) => openFiscalPeriod(periodId, { close_previous }),
    onSuccess: invalidate,
  });
}
