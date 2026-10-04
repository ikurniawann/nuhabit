import type { InventoryListParams } from "./types";

export const inventoryQueryKeys = {
  all: ["inventory"] as const,
  list: (params: InventoryListParams) => ["inventory", "list", params] as const,
  summary: ["inventory", "summary"] as const,
  detail: (id: string) => ["inventory", "detail", id] as const,
  movements: (id: string, page: number, limit: number) =>
    ["inventory", "movements", id, page, limit] as const,
};
