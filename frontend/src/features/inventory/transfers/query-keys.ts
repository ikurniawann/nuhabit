import type { StockTransferListParams } from "./types";

export const stockTransferQueryKeys = {
  all: ["stock-transfers"] as const,
  list: (params: StockTransferListParams) =>
    [...stockTransferQueryKeys.all, "list", params] as const,
  warehouses: () => [...stockTransferQueryKeys.all, "warehouses"] as const,
  sourceStock: (warehouseId: string) =>
    [...stockTransferQueryKeys.all, "source-stock", warehouseId] as const,
};
