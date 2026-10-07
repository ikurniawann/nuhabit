import type { ProductStockOpnameListParams } from "./types";

export const productStockOpnameQueryKeys = {
  all: ["product-stock-opname"] as const,
  list: (params: ProductStockOpnameListParams) =>
    [...productStockOpnameQueryKeys.all, "list", params] as const,
  detail: (id: string) =>
    [...productStockOpnameQueryKeys.all, "detail", id] as const,
  preview: (warehouseId: string) =>
    [...productStockOpnameQueryKeys.all, "preview", warehouseId] as const,
  warehouses: () => [...productStockOpnameQueryKeys.all, "warehouses"] as const,
};
