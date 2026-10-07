export const cashBankQueryKeys = {
  all: ["accounting", "cash-bank"] as const,
  list: () => [...cashBankQueryKeys.all, "list"] as const,
  ledger: (accountId: string, filters?: Record<string, string | undefined>) =>
    [...cashBankQueryKeys.all, "ledger", accountId, filters ?? {}] as const,
  movements: (kind: string, filters?: Record<string, unknown>) =>
    [...cashBankQueryKeys.all, "movements", kind, filters ?? {}] as const,
  accountOptions: () => [...cashBankQueryKeys.all, "account-options"] as const,
  transfers: (filters?: Record<string, unknown>) =>
    [...cashBankQueryKeys.all, "transfers", filters ?? {}] as const,
};
