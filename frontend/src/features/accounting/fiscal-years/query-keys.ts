export const fiscalYearQueryKeys = {
  all: ["accounting", "fiscal-years"] as const,
  list: (filters?: Record<string, string | undefined>) =>
    [...fiscalYearQueryKeys.all, "list", filters ?? {}] as const,
  detail: (id: string) =>
    [...fiscalYearQueryKeys.all, "detail", id] as const,
  coverage: (date?: string) =>
    [...fiscalYearQueryKeys.all, "coverage", date ?? ""] as const,
};
