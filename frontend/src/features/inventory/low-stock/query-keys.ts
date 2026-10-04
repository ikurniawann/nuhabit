import type { LowStockParams } from "./types";

export const lowStockQueryKeys = {
  all: ["inventory", "low-stock"] as const,
  list: (params: LowStockParams) =>
    ["inventory", "low-stock", "list", params] as const,
};
