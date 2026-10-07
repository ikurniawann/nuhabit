"use client";

import { useQuery } from "@tanstack/react-query";
import { salaryQueryKeys } from "./query-keys";
import { fetchSalaries, fetchSalary, fetchSalaryEmployees } from "./api";

export const useSalaryList = () =>
  useQuery({ queryKey: salaryQueryKeys.list(), queryFn: fetchSalaries });

export const useSalary = (id: string) =>
  useQuery({
    queryKey: salaryQueryKeys.detail(id),
    queryFn: () => fetchSalary(id),
    enabled: !!id,
  });

export const useSalaryEmployees = () =>
  useQuery({ queryKey: salaryQueryKeys.employees(), queryFn: fetchSalaryEmployees });
