import type { ItemsLookupType, ItemsLookupRecord, ItemsLookupFormData } from "@/lib/purchasing/items-lookup";

export type {
  ItemsLookupType,
  ItemsLookupRecord,
  ItemsLookupFormData,
} from "@/lib/purchasing/items-lookup";

function apiBase(type: ItemsLookupType) {
  return `/api/purchasing/items/${type}`;
}

async function parseJson<T>(res: Response, fallback: string): Promise<T> {
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || json.message || fallback);
  return json as T;
}

export async function listItemsLookup(
  type: ItemsLookupType,
  search?: string,
  options?: { limit?: number }
): Promise<ItemsLookupRecord[]> {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (options?.limit) params.set("limit", String(options.limit));
  const res = await fetch(`${apiBase(type)}?${params.toString()}`);
  const json = await parseJson<{ data?: ItemsLookupRecord[] }>(res, "Gagal memuat data");
  return json.data || [];
}

export async function listActiveItemsLookup(
  type: ItemsLookupType
): Promise<ItemsLookupRecord[]> {
  const rows = await listItemsLookup(type, undefined, { limit: 200 });
  return rows.filter((row) => row.is_active);
}

export async function saveItemsLookup(
  type: ItemsLookupType,
  payload: ItemsLookupFormData,
  id?: string
): Promise<{ message?: string }> {
  const url = id ? `${apiBase(type)}/${id}` : apiBase(type);
  const res = await fetch(url, {
    method: id ? "PUT" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJson<{ message?: string }>(res, "Gagal menyimpan");
}

export async function deleteItemsLookup(
  type: ItemsLookupType,
  id: string
): Promise<{ message?: string }> {
  const res = await fetch(`${apiBase(type)}/${id}`, { method: "DELETE" });
  return parseJson<{ message?: string }>(res, "Gagal menghapus");
}
