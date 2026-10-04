import type { ContractListParams } from "./api";

export const contractQueryKeys = {
  list: (params: ContractListParams) => ["hris", "contracts", params] as const,
  kpiRecommendation: (employeeIds: string[]) =>
    ["hris", "kpi", "recommendation", employeeIds] as const,
};
