"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchOvertime } from "./api";
import { overtimeQueryKeys } from "./query-keys";
import type { OvertimeFilters } from "./types";

export const useOvertimeRequests = (filters: OvertimeFilters) =>
  useQuery({ queryKey: overtimeQueryKeys.list(filters), queryFn: () => fetchOvertime(filters) });
