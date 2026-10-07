import type { StockOpnameListParams } from "./types";

export const stockOpnameQueryKeys = {
  all: ["stock-opnames"] as const,
  list: (params: StockOpnameListParams) =>
    [...stockOpnameQueryKeys.all, "list", params] as const,
  detail: (id: string) => [...stockOpnameQueryKeys.all, "detail", id] as const,
  warehouses: () => [...stockOpnameQueryKeys.all, "warehouses"] as const,
  preview: (warehouseId: string) =>
    [...stockOpnameQueryKeys.all, "preview", warehouseId] as const,
};
