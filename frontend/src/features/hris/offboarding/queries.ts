"use client";

import { useQuery } from "@tanstack/react-query";
import { offboardingQueryKeys } from "./query-keys";
import { fetchOffboardingEmployee, fetchOffboardingRecord } from "./api";

export const useOffboardingEmployee = (employeeId: string) =>
  useQuery({
    queryKey: offboardingQueryKeys.employee(employeeId),
    queryFn: () => fetchOffboardingEmployee(employeeId),
    enabled: Boolean(employeeId),
  });

export const useOffboardingRecord = (employeeId: string) =>
  useQuery({
    queryKey: offboardingQueryKeys.record(employeeId),
    queryFn: () => fetchOffboardingRecord(employeeId),
    enabled: Boolean(employeeId),
  });
