import type { LowStockItem, LowStockParams } from "./types";

export type * from "./types";

export async function listLowStock(
  params: LowStockParams = {},
): Promise<LowStockItem[]> {
  const sp = new URLSearchParams();
  if (params.category && params.category !== "all")
    sp.set("category", params.category);
  if (params.status && params.status !== "all") sp.set("status", params.status);

  const res = await fetch(`/api/inventory/low-stock?${sp.toString()}`);
  const data = await res.json();
  return data.data || [];
}
