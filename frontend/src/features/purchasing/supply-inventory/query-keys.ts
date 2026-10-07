import type { SupplyStockListParams } from "./types";

export const supplyInventoryKeys = {
  all: ["purchasing", "supply-inventory"] as const,
  list: (params: SupplyStockListParams) =>
    ["purchasing", "supply-inventory", "list", params] as const,
  detail: (id: string) => ["purchasing", "supply-inventory", "detail", id] as const,
  formData: () => ["purchasing", "supply-inventory", "form-data"] as const,
  usages: () => ["purchasing", "supply-inventory", "usages"] as const,
};
