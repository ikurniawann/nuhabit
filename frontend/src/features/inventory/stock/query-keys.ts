import type { StockListParams } from "./types";

export const stockQueryKeys = {
  all: ["inventory", "stock"] as const,
  rawMaterial: (params: StockListParams) =>
    [...stockQueryKeys.all, "raw-material", params] as const,
  product: (params: StockListParams) =>
    [...stockQueryKeys.all, "product", params] as const,
};
