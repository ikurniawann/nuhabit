import type { Vendor, VendorFormData, VendorListParams } from "./types";

function buildListParams(params: VendorListParams) {
  const sp = new URLSearchParams();
  if (params.search) sp.set("search", params.search);
  if (params.category && params.category !== "all") sp.set("category", params.category);
  if (params.usage_scope && params.usage_scope !== "all") sp.set("usage_scope", params.usage_scope);
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

export async function listVendors(params: VendorListParams = {}) {
  const res = await fetch(`/api/purchasing/vendors?${buildListParams(params).toString()}`);
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error || json.message || "Failed to load vendors");
  }
  return res.json() as Promise<{
    data: Vendor[];
    pagination: { total: number; total_pages: number; page: number; limit: number };
  }>;
}

export async function getVendor(id: string) {
  const res = await fetch(`/api/purchasing/vendors/${id}`);
  const json = await parseJson<{ data: Vendor }>(res, "Failed to load vendor");
  return json.data;
}

export async function createVendor(payload: VendorFormData) {
  const res = await fetch("/api/purchasing/vendors", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await parseJson<{ data: Vendor }>(res, "Failed to create vendor");
  return json.data;
}

export async function updateVendor(id: string, payload: Partial<VendorFormData> & { is_active?: boolean }) {
  const res = await fetch(`/api/purchasing/vendors/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await parseJson<{ data: Vendor }>(res, "Failed to update vendor");
  return json.data;
}

export async function deactivateVendor(id: string) {
  const res = await fetch(`/api/purchasing/vendors/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error || json.message || "Failed to deactivate vendor");
  }
}
