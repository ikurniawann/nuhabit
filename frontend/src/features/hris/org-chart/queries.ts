"use client";

import { useQuery } from "@tanstack/react-query";
import { orgChartQueryKeys } from "./query-keys";
import { fetchOrgEmployees, fetchOrgDepartments } from "./api";

export const useOrgEmployees = () =>
  useQuery({
    queryKey: orgChartQueryKeys.employees(),
    queryFn: fetchOrgEmployees,
  });

export const useOrgDepartments = () =>
  useQuery({
    queryKey: orgChartQueryKeys.departments(),
    queryFn: fetchOrgDepartments,
  });
