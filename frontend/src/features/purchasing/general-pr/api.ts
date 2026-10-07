import { apiGet, apiPost, apiPut } from "@/lib/api-client";
import type {
  GeneralPRDetail,
  GeneralPRFormData,
  GeneralPRFormPayload,
  GeneralPRListParams,
  GeneralPRListResult,
} from "./types";

const MODULE_TYPE = "general";

function normalizePayload(payload: GeneralPRFormPayload): GeneralPRFormPayload {
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

export async function listGeneralPurchaseRequests(
  params: GeneralPRListParams = {}
): Promise<GeneralPRListResult> {
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

export async function getGeneralPRFormData(): Promise<GeneralPRFormData> {
  const json = await apiGet<{ data: GeneralPRFormData }>(
    `/api/purchasing/pr/form-data?module_type=${MODULE_TYPE}`
  );
  return json.data;
}

export async function getGeneralPurchaseRequest(id: string): Promise<GeneralPRDetail> {
  const json = await apiGet<{ data: GeneralPRDetail }>(`/api/purchasing/pr/${id}`);
  return json.data;
}

export async function createGeneralPurchaseRequest(payload: GeneralPRFormPayload) {
  return apiPost<{ data: { id: string; pr_number?: string; status?: string } }>(
    "/api/purchasing/pr",
    normalizePayload(payload)
  );
}

export async function updateGeneralPurchaseRequest(id: string, payload: GeneralPRFormPayload) {
  return apiPut<{ data: { id: string; status: string } }>(
    `/api/purchasing/pr/${id}`,
    normalizePayload(payload)
  );
}
