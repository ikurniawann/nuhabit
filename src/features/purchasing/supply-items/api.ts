import { listUnits } from "@/lib/purchasing/api-client/units";
import { listActiveItemsLookup } from "@/features/purchasing/items/api";
import type { Unit } from "@/types/purchasing";
import type {
  SupplyItem,
  SupplyItemFormData,
  SupplyItemListParams,
  SupplyItemListResult,
} from "./types";

const BASE = "/api/purchasing/supply-items";

async function parseJson<T>(res: Response, fallback: string): Promise<T> {
  const json = await res.json();
  if (!res.ok || json?.success === false) {
    throw new Error(json?.error || json?.message || fallback);
  }
  return json as T;
}

export async function listSupplyItems(
  params: SupplyItemListParams
): Promise<SupplyItemListResult> {
  const sp = new URLSearchParams();
  if (params.search) sp.set("search", params.search);
  if (params.is_active) sp.set("is_active", params.is_active);
  if (params.stockable) sp.set("stockable", params.stockable);
  sp.set("page", String(params.page ?? 1));
  sp.set("limit", String(params.limit ?? 20));
  const res = await fetch(`${BASE}?${sp.toString()}`);
  return parseJson<SupplyItemListResult>(res, "Gagal memuat barang operasional");
}

export async function createSupplyItem(payload: SupplyItemFormData): Promise<SupplyItem> {
  const res = await fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await parseJson<{ data: SupplyItem }>(res, "Gagal menyimpan barang");
  return json.data;
}

export async function updateSupplyItem(
  id: string,
  payload: Partial<SupplyItemFormData>
): Promise<SupplyItem> {
  const res = await fetch(`${BASE}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await parseJson<{ data: SupplyItem }>(res, "Gagal memperbarui barang");
  return json.data;
}

export async function deleteSupplyItem(id: string): Promise<void> {
  const res = await fetch(`${BASE}/${id}`, { method: "DELETE" });
  await parseJson<{ success: boolean }>(res, "Gagal menghapus barang");
}

export interface SupplyItemFormDeps {
  categories: { code: string; nama: string }[];
  units: Unit[];
}

export async function getSupplyItemFormDeps(): Promise<SupplyItemFormDeps> {
  const [categories, unitsRes] = await Promise.all([
    listActiveItemsLookup("supply-categories").catch(() => []),
    listUnits().catch(() => ({ data: [] as Unit[] })),
  ]);
  return {
    categories: categories.map((c) => ({ code: c.code, nama: c.nama })),
    units: (unitsRes as { data: Unit[] }).data ?? [],
  };
}
