import type { LeaveListParams } from "./types";

export const leavesQueryKeys = {
  all: ["hris", "leaves"] as const,
  list: (params?: LeaveListParams) =>
    ["hris", "leaves", "list", params ?? {}] as const,
  employees: () => ["hris", "leaves", "employees-lite"] as const,
};
