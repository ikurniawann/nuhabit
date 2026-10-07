"use client";

import { useQuery } from "@tanstack/react-query";
import { payrollQueryKeys } from "./query-keys";
import {
  fetchPayrollRuns,
  fetchPayrollRun,
  fetchPayslip,
  fetchPayrollSettings,
} from "./api";

export const usePayrollRuns = () =>
  useQuery({
    queryKey: payrollQueryKeys.runs(),
    queryFn: fetchPayrollRuns,
  });

export const usePayrollRun = (id: string) =>
  useQuery({
    queryKey: payrollQueryKeys.run(id),
    queryFn: () => fetchPayrollRun(id),
    enabled: !!id,
  });

export const usePayslip = (payrollRunId: string, employeeId: string) =>
  useQuery({
    queryKey: payrollQueryKeys.payslip(payrollRunId, employeeId),
    queryFn: () => fetchPayslip(payrollRunId, employeeId),
    enabled: !!payrollRunId && !!employeeId,
  });

export const usePayrollSettings = (taxYear?: number) =>
  useQuery({
    queryKey: payrollQueryKeys.settings(taxYear),
    queryFn: () => fetchPayrollSettings(taxYear),
  });
