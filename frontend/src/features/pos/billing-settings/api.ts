import type { BillingOptions, BillingProfile, UpsertBillingProfilePayload } from "./types";

async function parseJson<T>(res: Response): Promise<T> {
  const json = (await res.json()) as T & { success?: boolean; error?: string; message?: string };
  if (!res.ok || json.success === false) {
    throw new Error(json.error || json.message || `Request failed (${res.status})`);
  }
  return json;
}

export async function fetchBillingOptions(branchId?: string | null): Promise<BillingOptions> {
  const sp = new URLSearchParams({ mode: "options" });
  if (branchId) sp.set("branch_id", branchId);
  const res = await fetch(`/api/pos/billing-settings?${sp}`, {
    credentials: "include",
    cache: "no-store",
  });
  const json = await parseJson<{ data: BillingOptions }>(res);
  return json.data;
}

export async function resolveBillingProfile(params: {
  branchId?: string | null;
  warehouseId?: string | null;
}): Promise<BillingProfile> {
  const sp = new URLSearchParams({ mode: "resolve" });
  if (params.branchId) sp.set("branch_id", params.branchId);
  if (params.warehouseId) sp.set("warehouse_id", params.warehouseId);
  const res = await fetch(`/api/pos/billing-settings?${sp}`, {
    credentials: "include",
    cache: "no-store",
  });
  const json = await parseJson<{ data: { profile: BillingProfile } }>(res);
  return json.data.profile;
}

export async function saveBillingProfile(
  payload: UpsertBillingProfilePayload
): Promise<BillingProfile> {
  const res = await fetch("/api/pos/billing-settings", {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await parseJson<{ data: BillingProfile }>(res);
  return json.data;
}
