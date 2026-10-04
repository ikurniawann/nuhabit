"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { payrollQueryKeys } from "./query-keys";
import {
  createPayrollRun,
  calculatePayroll,
  updatePayrollStatus,
  deletePayrollRun,
  savePayrollSettings,
  notifyPayslip,
  type SavePayrollSettingsPayload,
} from "./api";
import type { CreatePayrollPayload } from "./types";

export function useCreatePayrollRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreatePayrollPayload) => createPayrollRun(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: payrollQueryKeys.all }),
  });
}

export function useCalculatePayroll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ runId, includeThr }: { runId: string; includeThr: boolean }) =>
      calculatePayroll(runId, includeThr),
    onSuccess: () => qc.invalidateQueries({ queryKey: payrollQueryKeys.all }),
  });
}

export function useUpdatePayrollStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ runId, status }: { runId: string; status: string }) =>
      updatePayrollStatus(runId, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: payrollQueryKeys.all }),
  });
}

export function useDeletePayrollRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) => deletePayrollRun(runId),
    onSuccess: () => qc.invalidateQueries({ queryKey: payrollQueryKeys.all }),
  });
}

export function useSavePayrollSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: SavePayrollSettingsPayload) =>
      savePayrollSettings(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: payrollQueryKeys.all }),
  });
}

/** Kirim notifikasi WA slip terbit; segarkan run agar tanda terkirim muncul. */
export function useNotifyPayslip(runId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payrollDetailId: string) => notifyPayslip(payrollDetailId),
    onSuccess: () => qc.invalidateQueries({ queryKey: payrollQueryKeys.run(runId) }),
  });
}
