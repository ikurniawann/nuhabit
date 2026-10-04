export const apKeys = {
  all: ["accounting", "ap"] as const,
  invoices: (filters?: Record<string, unknown>) =>
    [...apKeys.all, "invoices", filters ?? {}] as const,
  payments: (filters?: Record<string, unknown>) =>
    [...apKeys.all, "payments", filters ?? {}] as const,
  payable: () => [...apKeys.all, "payable"] as const,
  aging: (asOf?: string) => [...apKeys.all, "aging", asOf ?? ""] as const,
};
