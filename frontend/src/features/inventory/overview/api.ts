import type {
  InventoryItem,
  InventoryListParams,
  InventoryListResult,
  InventoryMovementsResult,
  InventorySummary,
} from "./types";

export type * from "./types";

export async function listInventory(
  params: InventoryListParams = {},
): Promise<InventoryListResult> {
  const sp = new URLSearchParams();
  if (params.page) sp.set("page", String(params.page));
  if (params.limit) sp.set("limit", String(params.limit));
  if (params.status && params.status !== "all") sp.set("status", params.status);
  if (params.search) sp.set("search", params.search);

  const res = await fetch(`/api/inventory?${sp.toString()}`);
  const data = await res.json();
  return {
    items: data.data?.data || data.data || [],
    total: data.pagination?.total || 0,
  };
}

export async function getInventorySummary(): Promise<InventorySummary> {
  const res = await fetch(`/api/inventory?limit=1000`);
  const data = await res.json();
  const all: InventoryItem[] = data.data?.data || data.data || [];
  return {
    total: all.length,
    low: all.filter((i) => i.stock_status === "low_stock").length,
    out: all.filter((i) => i.stock_status === "out_of_stock").length,
    totalValue: all.reduce((s, i) => s + (i.total_value || 0), 0),
  };
}

export async function getInventoryItem(
  id: string,
): Promise<InventoryItem | null> {
  const res = await fetch(`/api/inventory?limit=1000`);
  const data = await res.json();
  const list: InventoryItem[] = data.data?.data || data.data || [];
  return list.find((i) => i.id === id) || null;
}

export async function listInventoryMovements(
  id: string,
  page = 1,
  limit = 25,
): Promise<InventoryMovementsResult> {
  const res = await fetch(
    `/api/inventory/${id}/movements?page=${page}&limit=${limit}`,
  );
  const data = await res.json();
  return {
    data: data.data?.data || data.data || [],
    total: data.pagination?.total || 0,
  };
}
