export const journalMappingQueryKeys = {
  all: ["accounting", "journal-mappings"] as const,
  list: (filters?: Record<string, string | undefined>) =>
    [...journalMappingQueryKeys.all, "list", filters ?? {}] as const,
  detail: (id: string) =>
    [...journalMappingQueryKeys.all, "detail", id] as const,
};
