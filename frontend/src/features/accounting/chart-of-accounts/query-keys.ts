export const coaQueryKeys = {
  all: ["accounting", "chart-of-accounts"] as const,
  list: (filters?: Record<string, string | undefined>) =>
    [...coaQueryKeys.all, "list", filters ?? {}] as const,
};
