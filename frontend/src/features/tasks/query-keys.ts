import type { TaskListFilter } from "./types";

export const taskKeys = {
  all: ["dept-tasks"] as const,
  meta: () => ["dept-tasks", "meta"] as const,
  list: (filter: TaskListFilter) => ["dept-tasks", "list", filter] as const,
  detail: (id: string) => ["dept-tasks", "detail", id] as const,
  kpi: (params: { department_id?: string; month?: string }) => ["dept-tasks", "kpi", params] as const,
  contributions: (params: { employee_id: string; month: string }) => ["dept-tasks", "contributions", params] as const,
  monitor: (params: { department_id?: string; month: string }) => ["dept-tasks", "monitor", params] as const,
};
