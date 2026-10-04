import type { SupplyItemListParams } from "./types";

export const supplyItemsQueryKeys = {
  all: ["purchasing", "supply-items"] as const,
  list: (params: SupplyItemListParams) =>
    ["purchasing", "supply-items", "list", params] as const,
  detail: (id: string) => ["purchasing", "supply-items", "detail", id] as const,
  formDeps: ["purchasing", "supply-items", "form-deps"] as const,
};
