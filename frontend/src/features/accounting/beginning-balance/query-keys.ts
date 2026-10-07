export const beginningBalanceQueryKeys = {
  all: ["accounting", "beginning-balance"] as const,
  detail: (fiscalYearId: string) =>
    [...beginningBalanceQueryKeys.all, fiscalYearId] as const,
};
