export const journalEntryQueryKeys = {
  all: ["accounting", "journal-entries"] as const,
  list: (filters?: Record<string, string | undefined>) =>
    [...journalEntryQueryKeys.all, "list", filters ?? {}] as const,
  detail: (id: string) =>
    [...journalEntryQueryKeys.all, "detail", id] as const,
};
