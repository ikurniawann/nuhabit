"use client";

import { useQuery } from "@tanstack/react-query";
import { leavesQueryKeys } from "./query-keys";
import { fetchLeaveList, fetchLeaveEmployees } from "./api";
import type { LeaveListParams } from "./types";

export const useLeaveList = (params?: LeaveListParams) =>
  useQuery({
    queryKey: leavesQueryKeys.list(params),
    queryFn: () => fetchLeaveList(params),
  });

export const useLeaveEmployees = () =>
  useQuery({
    queryKey: leavesQueryKeys.employees(),
    queryFn: fetchLeaveEmployees,
  });
