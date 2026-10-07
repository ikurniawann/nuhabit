import { apiGet, apiPost, apiPut } from "@/lib/api-client";
import type {
  ProductPRDetail,
  ProductPRFormData,
  ProductPRFormPayload,
  ProductPRListParams,
  ProductPRListResult,
} from "./types";

const MODULE_TYPE = "product";

function normalizePayload(payload: ProductPRFormPayload): ProductPRFormPayload {
  return {
    ...payload,
    module_type: MODULE_TYPE,
    required_date: payload.required_date?.trim() || undefined,
    notes: payload.notes?.trim() || undefined,
    items: payload.items.map((item) => ({
      ...item,
      satuan_id: item.satuan_id?.trim() || undefined,
    })),
  };
}

export async function listProductPurchaseRequests(
  params: ProductPRListParams = {}
): Promise<ProductPRListResult> {
  const sp = new URLSearchParams();
  sp.set("module_type", MODULE_TYPE);
  if (params.page) sp.set("page", String(params.page));
  if (params.limit) sp.set("limit", String(params.limit));
  if (params.status) sp.set("status", params.status);
  if (params.search) sp.set("search", params.search);

  const res = await fetch(`/api/purchasing/pr?${sp.toString()}`);
  const json = await res.json();
  if (!res.ok) throw new Error(json.message || json.error || `HTTP ${res.status}`);

  return {
    data: json.data || [],
    total: json.pagination?.total || 0,
  };
}

export async function getProductPRFormData(): Promise<ProductPRFormData> {
  const json = await apiGet<{ data: ProductPRFormData }>(
    `/api/purchasing/pr/form-data?module_type=${MODULE_TYPE}`
  );
  return json.data;
}

export async function getProductPurchaseRequest(id: string): Promise<ProductPRDetail> {
  const json = await apiGet<{ data: ProductPRDetail }>(`/api/purchasing/pr/${id}`);
  return json.data;
}

export async function createProductPurchaseRequest(payload: ProductPRFormPayload) {
  return apiPost<{ data: { id: string; pr_number?: string; status?: string } }>(
    "/api/purchasing/pr",
    normalizePayload(payload)
  );
}

export async function updateProductPurchaseRequest(id: string, payload: ProductPRFormPayload) {
  return apiPut<{ data: { id: string; status: string } }>(
    `/api/purchasing/pr/${id}`,
    normalizePayload(payload)
  );
}
