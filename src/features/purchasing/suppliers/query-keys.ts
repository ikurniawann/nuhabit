import type { SupplierListParams } from "@/types/supplier";

export const suppliersQueryKeys = {
  all: ["purchasing", "suppliers"] as const,
  list: (params: SupplierListParams) =>
    ["purchasing", "suppliers", "list", params] as const,
  detail: (id: string) => ["purchasing", "suppliers", "detail", id] as const,
  poHistory: (id: string) =>
    ["purchasing", "suppliers", "po-history", id] as const,
  prices: (id: string) => ["purchasing", "suppliers", "prices", id] as const,
  priceHistory: (id: string, months: number, materialId: string) =>
    ["purchasing", "suppliers", "price-history", id, months, materialId] as const,
};
