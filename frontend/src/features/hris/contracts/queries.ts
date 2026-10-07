"use client";

import { useQuery } from "@tanstack/react-query";
import { contractQueryKeys } from "./query-keys";
import { fetchContractList, fetchKpiRecommendation, type ContractListParams } from "./api";

export const useContractList = (params: ContractListParams) =>
  useQuery({
    queryKey: contractQueryKeys.list(params),
    queryFn: () => fetchContractList(params),
  });

export const useKpiRecommendation = (employeeIds: string[]) =>
  useQuery({
    queryKey: contractQueryKeys.kpiRecommendation(employeeIds),
    queryFn: () => fetchKpiRecommendation(employeeIds),
    enabled: employeeIds.length > 0,
  });
