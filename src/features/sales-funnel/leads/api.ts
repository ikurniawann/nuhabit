import { parseError } from "../api-error";
import type {
  CustomerSearchResult,
  LeadDetail,
  LeadFilters,
  LeadFormValues,
  LeadListResponse,
  PicLookupResult,
} from "./types";

export async function fetchLeads(filters: LeadFilters): Promise<LeadListResponse> {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.status) params.set("status", filters.status);
  if (filters.org_type) params.set("org_type", filters.org_type);
  if (filters.source) params.set("source", filters.source);
  if (filters.sort === "score") params.set("sort", "score");
  params.set("page", String(filters.page));
  params.set("limit", "20");

  const res = await fetch(`/api/sales-funnel/leads?${params.toString()}`);
  if (!res.ok) await parseError(res, "Gagal memuat leads");
  return res.json();
}

export async function createLead(values: LeadFormValues) {
  const res = await fetch("/api/sales-funnel/leads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(values),
  });
  if (!res.ok) await parseError(res, "Gagal membuat lead");
  return res.json();
}

export async function updateLead(id: string, values: Partial<LeadFormValues>) {
  const res = await fetch(`/api/sales-funnel/leads/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(values),
  });
  if (!res.ok) await parseError(res, "Gagal memperbarui lead");
  return res.json();
}

export async function deleteLead(id: string) {
  const res = await fetch(`/api/sales-funnel/leads/${id}`, { method: "DELETE" });
  if (!res.ok && res.status !== 204) await parseError(res, "Gagal menghapus lead");
}

// ── Detail 360° & tautan member (Fase D) ──

export async function fetchLeadDetail(id: string): Promise<LeadDetail> {
  const res = await fetch(`/api/sales-funnel/leads/${id}`);
  if (!res.ok) await parseError(res, "Gagal memuat detail instansi");
  const body = (await res.json()) as { data: LeadDetail };
  return body.data;
}

export async function lookupPicByPhone(
  phone: string
): Promise<PicLookupResult | null> {
  const res = await fetch(
    `/api/sales-funnel/leads/by-phone?phone=${encodeURIComponent(phone)}`
  );
  if (!res.ok) await parseError(res, "Gagal mencari PIC");
  const body = (await res.json()) as { data: PicLookupResult | null };
  return body.data;
}

export async function searchCustomers(q: string): Promise<CustomerSearchResult[]> {
  const res = await fetch(
    `/api/sales-funnel/customers?q=${encodeURIComponent(q)}`
  );
  if (!res.ok) await parseError(res, "Gagal mencari member");
  const body = (await res.json()) as { data: CustomerSearchResult[] };
  return body.data;
}

export async function linkLeadCustomer(
  leadId: string,
  payload: { customer_id?: string; create_from_pic?: boolean }
) {
  const res = await fetch(`/api/sales-funnel/leads/${leadId}/link-customer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) await parseError(res, "Gagal menautkan member");
  return res.json();
}

export async function unlinkLeadCustomer(leadId: string) {
  const res = await fetch(`/api/sales-funnel/leads/${leadId}/link-customer`, {
    method: "DELETE",
  });
  if (!res.ok) await parseError(res, "Gagal melepas tautan member");
  return res.json();
}
