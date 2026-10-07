import type { CustomerListParams } from "./types";

export const topupQueryKeys = {
  all: ["pos", "topup"] as const,
  customers: (params: CustomerListParams) => ["pos", "topup", "customers", params] as const,
  history: (customerId: string) => ["pos", "topup", "history", customerId] as const,
};
