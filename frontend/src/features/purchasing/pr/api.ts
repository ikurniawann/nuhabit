import { apiGet, apiPost, apiPut } from "@/lib/api-client";
import type {
  PRDetail,
  PRFormData,
  PRFormPayload,
  PRListParams,
  PRListResult,
} from "./types";

export type * from "./types";

function normalizePRPayload(payload: PRFormPayload): PRFormPayload {
  return {
    ...payload,
    required_date: payload.required_date?.trim() || undefined,
    notes: payload.notes?.trim() || undefined,
    items: payload.items.map((item) => ({
      ...item,
      satuan_id: item.satuan_id?.trim() || undefined,
    })),
  };
}

export async function listPurchaseRequests(
  params: PRListParams = {}
): Promise<PRListResult> {
  const sp = new URLSearchParams();
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

export async function getPRFormData(): Promise<PRFormData> {
  const json = await apiGet<{ data: PRFormData }>("/api/purchasing/pr/form-data");
  return json.data;
}

export async function getPurchaseRequest(id: string): Promise<PRDetail> {
  const json = await apiGet<{ data: PRDetail }>(`/api/purchasing/pr/${id}`);
  return json.data;
}

export async function createPurchaseRequest(payload: PRFormPayload) {
  return apiPost<{ data: { id: string; pr_number?: string; status?: string } }>(
    "/api/purchasing/pr",
    normalizePRPayload(payload)
  );
}

export async function updatePurchaseRequest(id: string, payload: PRFormPayload) {
  return apiPut<{ data: { id: string; status: string } }>(
    `/api/purchasing/pr/${id}`,
    normalizePRPayload(payload)
  );
}
