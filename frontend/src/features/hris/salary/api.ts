import { apiGet, apiPost, apiPut } from "@/lib/api-client";
import type { EmployeeSalary, SalaryEmployeeLite, SalaryPayload } from "./types";

export const fetchSalaries = () =>
  apiGet<{ data: EmployeeSalary[] }>("/api/hris/employee-salary?active_only=true").then(
    (res) => (res.data || []).filter((s) => s.is_active)
  );

export const fetchSalary = (id: string) =>
  apiGet<{ data: EmployeeSalary }>(`/api/hris/employee-salary/${id}`).then(
    (res) => res.data
  );

export const fetchSalaryEmployees = () =>
  apiGet<{ data: SalaryEmployeeLite[] }>("/api/hris/employees").then(
    (res) => res.data || []
  );

export const createSalary = (payload: SalaryPayload) =>
  apiPost<{ data: EmployeeSalary }>("/api/hris/employee-salary", payload);

export const updateSalary = (id: string, payload: SalaryPayload) =>
  apiPut<{ data: EmployeeSalary }>(`/api/hris/employee-salary/${id}`, payload);
