import { apiGet, apiPost, apiPut, apiDelete } from "@/lib/api-client";
import type {
  PayrollRun,
  CreatePayrollPayload,
  CalculatePayrollResult,
  PayrollRunDetail,
  PayslipDetail,
} from "./types";

export const fetchPayrollRuns = () =>
  apiGet<{ data: PayrollRun[] }>("/api/hris/payroll").then((res) => res.data || []);

export const fetchPayrollRun = (id: string) =>
  apiGet<{ data: PayrollRunDetail }>(`/api/hris/payroll/${id}`).then((res) => res.data);

export const createPayrollRun = (payload: CreatePayrollPayload) =>
  apiPost<{ data: PayrollRun }>("/api/hris/payroll", payload);

export const calculatePayroll = (runId: string, includeThr: boolean) =>
  apiPost<CalculatePayrollResult>(`/api/hris/payroll/${runId}/calculate`, {
    include_thr: includeThr,
  });

export const updatePayrollStatus = (runId: string, status: string) =>
  apiPut<{ data: PayrollRun }>(`/api/hris/payroll/${runId}`, { status });

export const deletePayrollRun = (runId: string) =>
  apiDelete(`/api/hris/payroll/${runId}`);

export const notifyPayslip = (payrollDetailId: string) =>
  apiPost<{ message?: string; data?: { wa_link?: string | null } }>("/api/hris/payslips/notify", {
    payroll_detail_id: payrollDetailId,
  });

export const fetchPayslip = (payrollRunId: string, employeeId: string) =>
  apiGet<{ data: PayslipDetail[] }>(
    `/api/hris/payslips?payroll_run_id=${payrollRunId}&employee_id=${employeeId}`
  ).then((res) => res.data?.[0] ?? null);

// ---- Pengaturan payroll (payroll_settings + payroll_tax_config) ----

export type PayrollSettingsRow = Record<string, unknown> & { id?: string };

export interface PayrollSettingsData {
  settings: PayrollSettingsRow | null;
  tax_config: PayrollSettingsRow | null;
  tax_year: number;
}

export interface SavePayrollSettingsPayload {
  settings?: Record<string, unknown>;
  tax_config?: Record<string, unknown> & { tax_year: number };
}

export const fetchPayrollSettings = (taxYear?: number) =>
  apiGet<{ data: PayrollSettingsData }>(
    `/api/hris/payroll-settings${taxYear ? `?tax_year=${taxYear}` : ""}`
  ).then((res) => res.data);

export const savePayrollSettings = (payload: SavePayrollSettingsPayload) =>
  apiPut<{ data: PayrollSettingsData }>("/api/hris/payroll-settings", payload);
