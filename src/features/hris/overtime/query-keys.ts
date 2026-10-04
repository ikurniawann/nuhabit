import type { OvertimeFilters } from "./types";

export const overtimeQueryKeys = {
  lists: () => ["hris", "overtime", "list"] as const,
  list: (filters: OvertimeFilters) => ["hris", "overtime", "list", filters] as const,
};
