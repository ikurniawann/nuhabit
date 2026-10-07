import type { RawMaterialListParams } from "@/types/purchasing";

export const rawMaterialsQueryKeys = {
  all: ["purchasing", "raw-materials"] as const,
  list: (params: RawMaterialListParams) =>
    ["purchasing", "raw-materials", "list", params] as const,
  detail: (id: string) => ["purchasing", "raw-materials", "detail", id] as const,
  priceHistory: (id: string, months: number) =>
    ["purchasing", "raw-materials", "price-history", id, months] as const,
  units: () => ["purchasing", "raw-materials", "units"] as const,
  categories: () => ["purchasing", "raw-materials", "categories"] as const,
};
