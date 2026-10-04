"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api-client";
import { employeeComboOptions, type EmployeeBrief } from "@/lib/hris/loans-view";

const fetchActiveEmployeeOptions = () =>
  apiGet<{ data: EmployeeBrief[] }>("/api/hris/employees?is_active=true&limit=500").then((res) =>
    employeeComboOptions(res.data ?? [])
  );

/** Pilihan combobox karyawan aktif (form pinjaman & lembur). */
export const useEmployeeOptions = () =>
  useQuery({ queryKey: ["hris", "employee-options"], queryFn: fetchActiveEmployeeOptions });
