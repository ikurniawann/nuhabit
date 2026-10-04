import { parseError } from "../api-error";
import type { AccountDetail, AccountFilters, AccountFormValues, AccountListResponse } from "./types";

export async function fetchAccounts(filters: AccountFilters): Promise<AccountListResponse> {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.account_type) params.set("account_type", filters.account_type);
  if (filters.city) params.set("city", filters.city);
  params.set("page", String(filters.page));
  params.set("limit", "20");
  const res = await fetch(`/api/sales-funnel/accounts?${params.toString()}`);
  if (!res.ok) await parseError(res, "Gagal memuat accounts");
  return res.json();
}

export async function fetchAccountDetail(id: string): Promise<AccountDetail> {
  const res = await fetch(`/api/sales-funnel/accounts/${id}`);
  if (res.status === 404) return null as unknown as AccountDetail;
  if (!res.ok) await parseError(res, "Gagal memuat account");
  const body = (await res.json()) as { data: AccountDetail };
  return body.data;
}

export async function createAccount(values: AccountFormValues) {
  const res = await fetch("/api/sales-funnel/accounts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(values),
  });
  if (!res.ok) await parseError(res, "Gagal membuat account");
  return res.json();
}

export async function updateAccount(id: string, values: Partial<AccountFormValues>) {
  const res = await fetch(`/api/sales-funnel/accounts/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(values),
  });
  if (!res.ok) await parseError(res, "Gagal memperbarui account");
  return res.json();
}

export async function deleteAccount(id: string) {
  const res = await fetch(`/api/sales-funnel/accounts/${id}`, { method: "DELETE" });
  if (!res.ok && res.status !== 204) await parseError(res, "Gagal menghapus account");
}
