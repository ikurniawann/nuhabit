import { parseError } from "../api-error";
import type { ContactFilters, ContactFormValues, ContactListResponse } from "./types";

export async function fetchContacts(filters: ContactFilters): Promise<ContactListResponse> {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.account_id) params.set("account_id", filters.account_id);
  params.set("page", String(filters.page));
  params.set("limit", "20");
  const res = await fetch(`/api/sales-funnel/contacts?${params.toString()}`);
  if (!res.ok) await parseError(res, "Gagal memuat contacts");
  return res.json();
}

function toPayload(values: Partial<ContactFormValues>) {
  const payload: Record<string, unknown> = { ...values };
  if ("account_id" in values) payload.account_id = values.account_id || null;
  if ("email" in values) payload.email = values.email || null;
  if ("title" in values) payload.title = values.title || null;
  if ("notes" in values) payload.notes = values.notes || null;
  return payload;
}

export async function createContact(values: ContactFormValues) {
  const res = await fetch("/api/sales-funnel/contacts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(toPayload(values)),
  });
  if (!res.ok) await parseError(res, "Gagal membuat contact");
  return res.json();
}

export async function updateContact(id: string, values: Partial<ContactFormValues>) {
  const res = await fetch(`/api/sales-funnel/contacts/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(toPayload(values)),
  });
  if (!res.ok) await parseError(res, "Gagal memperbarui contact");
  return res.json();
}

export async function deleteContact(id: string) {
  const res = await fetch(`/api/sales-funnel/contacts/${id}`, { method: "DELETE" });
  if (!res.ok && res.status !== 204) await parseError(res, "Gagal menghapus contact");
}
