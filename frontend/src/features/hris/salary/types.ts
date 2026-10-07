export interface SalaryEmployeeLite {
  id: string;
  full_name: string;
  nip: string;
  position?: { title: string };
  department?: { name: string };
}

export interface EmployeeSalary {
  id: string;
  employee_id: string;
  base_salary: number;
  fixed_allowance: number;
  variable_allowance?: number;
  transport_allowance: number;
  meal_allowance: number;
  housing_allowance?: number;
  loan_deduction?: number;
  other_deduction?: number;
  ptkp_status: string;
  is_taxable: boolean;
  bpjs_tk_enrolled?: boolean;
  bpjs_kes_enrolled?: boolean;
  tapera_enrolled?: boolean;
  is_active?: boolean;
  effective_date?: string;
  notes?: string;
  employee?: SalaryEmployeeLite;
}

export interface SalaryPayload {
  employee_id?: string;
  base_salary: number;
  fixed_allowance: number;
  variable_allowance: number;
  transport_allowance: number;
  meal_allowance: number;
  housing_allowance: number;
  loan_deduction: number;
  other_deduction: number;
  ptkp_status: string;
  is_taxable: boolean;
  bpjs_tk_enrolled: boolean;
  bpjs_kes_enrolled: boolean;
  tapera_enrolled: boolean;
  notes?: string;
}
