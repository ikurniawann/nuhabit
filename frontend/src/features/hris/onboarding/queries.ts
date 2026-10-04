"use client";

import { useQuery } from "@tanstack/react-query";
import { onboardingQueryKeys } from "./query-keys";
import { fetchOnboardingEmployee } from "./api";

export const useOnboardingEmployee = (employeeId: string) =>
  useQuery({
    queryKey: onboardingQueryKeys.employee(employeeId),
    queryFn: () => fetchOnboardingEmployee(employeeId),
    enabled: Boolean(employeeId),
  });
