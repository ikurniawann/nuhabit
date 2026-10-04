export const reportQueryKeys = {
  all: ["accounting", "reports"] as const,
  report: (kind: string, filters?: Record<string, string | undefined>) =>
    [...reportQueryKeys.all, kind, filters ?? {}] as const,
  dashboard: (filters: Record<string, string>) =>
    ["accounting", "dashboard", filters] as const,
};
