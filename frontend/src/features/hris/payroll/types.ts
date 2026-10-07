import type { LoanInstallmentDetail } from "@/lib/payroll/loans";

export interface PayrollRun {
  id: string;
  run_name: string;
  period_month: number;
  period_year: number;
  status: string;
  total_employees: number;
  total_gross: number;
  total_net: number;
  total_deductions: number;
  created_at: string;
  processed_at?: string;
  approved_at?: string;
  paid_at?: string;
}

export interface CreatePayrollPayload {
  period_month: number;
  period_year: number;
}

export interface CalculatePayrollResult {
  summary?: {
    total_employees?: number;
    employee_names?: string[];
  };
}

/** Baris payroll_details ringkas di halaman detail run. */
export interface PayrollRunDetailRow {
  id: string;
  employee_id: string;
  gross_salary: number;
  total_deductions: number;
  net_salary: number;
  pph21_deduction: number;
  bpjs_tk_jht_deduction: number;
  bpjs_kes_deduction: number;
  status: string;
  payslip_sent?: boolean;
  employee?: {
    id: string;
    full_name: string;
    nip: string;
    department?: { name: string };
  };
}

export interface PayrollRunDetail extends PayrollRun {
  total_pph21: number;
  total_bjtk_employee: number;
  total_bjtk_employer: number;
  notes?: string;
  payroll_details?: PayrollRunDetailRow[];
}

/** Nominal slip gaji (pg numeric bisa datang sebagai string). */
export interface PayslipAmounts {
  id: string;
  base_salary: number;
  fixed_allowance: number;
  variable_allowance: number;
  transport_allowance: number;
  meal_allowance: number;
  housing_allowance: number;
  overtime_pay: number;
  thr: number;
  bonus: number;
  gross_salary: number;
  bpjs_tk_jht_deduction: number;
  bpjs_tk_jp_deduction: number;
  bpjs_kes_deduction: number;
  tapera_deduction: number;
  pph21_deduction: number;
  unpaid_leave_deduction: number;
  late_deduction?: number;
  loan_deduction?: number;
  loan_details?: LoanInstallmentDetail[];
  other_deduction: number;
  total_deductions: number;
  net_salary: number;
  working_days: number;
  present_days: number;
  late_days: number;
  /** Faktor proraté cakupan kontrak (0..1); pg numeric datang sebagai string */
  prorate_factor?: number | string;
  /** Snapshot gaji pokok penuh sebelum proraté (null utk baris lama) */
  full_base_salary?: number | string | null;
}

/** Slip gaji satu karyawan (halaman admin). */
export interface PayslipDetail extends PayslipAmounts {
  employee_id: string;
  payroll_run_id: string;
  other_earning: number;
  unpaid_leave_days: number;
  status: string;
  created_at: string;
  employee?: {
    id: string;
    full_name: string;
    nip: string;
    email: string;
    phone: string;
    position?: { title: string };
    department?: { name: string };
  };
  payroll_run?: {
    id: string;
    period_month: number;
    period_year: number;
    run_name: string;
  };
}
