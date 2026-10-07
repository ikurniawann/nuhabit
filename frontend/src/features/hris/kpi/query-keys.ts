export const kpiQueryKeys = {
  all: ["hris", "kpi"] as const,
  scorecards: (params?: Record<string, unknown>) =>
    ["hris", "kpi", "scorecards", params ?? {}] as const,
  history: (employeeId: string, n: number) =>
    ["hris", "kpi", "history", employeeId, n] as const,
  targets: () => ["hris", "kpi", "targets"] as const,
  deptTasks: (month: string, departmentId: string) =>
    ["hris", "kpi", "dept-tasks", month, departmentId] as const,
  config: () => ["hris", "kpi", "config"] as const,
  perfRealtime: (year?: number, quarter?: number) =>
    ["hris", "kpi", "performance", "realtime", year ?? "current", quarter ?? "current"] as const,
  perfCycles: () => ["hris", "kpi", "performance", "cycles"] as const,
  perfReviews: (cycleId: string) => ["hris", "kpi", "performance", "reviews", cycleId] as const,
  perfReview: (id: string) => ["hris", "kpi", "performance", "review", id] as const,
  team: (params?: Record<string, unknown>) =>
    ["hris", "kpi", "team", params ?? {}] as const,
};
