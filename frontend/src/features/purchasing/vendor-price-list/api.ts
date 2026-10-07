import type {
  VendorPriceList,
  VendorPriceListFormData,
  VendorPriceListListParams,
} from "./types";

function buildListParams(params: VendorPriceListListParams) {
  const sp = new URLSearchParams();
  if (params.search) sp.set("search", params.search);
  if (params.vendor_id) sp.set("vendor_id", params.vendor_id);
  if (params.product_id) sp.set("product_id", params.product_id);
  if (params.status && params.status !== "all") sp.set("status", params.status);
  if (params.page) sp.set("page", String(params.page));
  if (params.limit) sp.set("limit", String(params.limit));
  return sp;
}

async function parseJson<T>(res: Response, fallback: string): Promise<T> {
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error || json.message || fallback);
  }
  return json;
}

export async function listVendorPriceLists(params: VendorPriceListListParams = {}) {
  const res = await fetch(`/api/purchasing/vendor-price-list?${buildListParams(params).toString()}`);
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error || json.message || "Failed to load price lists");
  }
  return res.json() as Promise<{
    data: VendorPriceList[];
    pagination: { total: number; total_pages: number; page: number; limit: number };
  }>;
}

export async function getVendorPriceList(id: string) {
  const res = await fetch(`/api/purchasing/vendor-price-list/${id}`);
  const json = await parseJson<{ data: VendorPriceList }>(res, "Failed to load price list");
  return json.data;
}

export async function createVendorPriceList(payload: VendorPriceListFormData) {
  const res = await fetch("/api/purchasing/vendor-price-list", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await parseJson<{ data: VendorPriceList }>(res, "Failed to create price list");
  return json.data;
}

export async function updateVendorPriceList(
  id: string,
  payload: Partial<VendorPriceListFormData> & { is_active?: boolean }
) {
  const res = await fetch(`/api/purchasing/vendor-price-list/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await parseJson<{ data: VendorPriceList }>(res, "Failed to update price list");
  return json.data;
}

export async function deleteVendorPriceList(id: string) {
  const res = await fetch(`/api/purchasing/vendor-price-list/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error || json.message || "Failed to delete price list");
  }
}
