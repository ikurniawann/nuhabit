export const periodQueryKeys = {
  all: ["accounting", "period"] as const,
  list: (filters?: Record<string, unknown>) =>
    [...periodQueryKeys.all, "list", filters ?? {}] as const,
  closePreview: (periodId: string) =>
    [...periodQueryKeys.all, "close-preview", periodId] as const,
};
