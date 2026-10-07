import { parseError } from "../api-error";
import type {
  ActivityFilters,
  ActivityFormValues,
  SalesActivity,
  WaTemplate,
} from "./types";
import { localInputToIso } from "./types";

export async function fetchActivities(
  filters: ActivityFilters
): Promise<SalesActivity[]> {
  const params = new URLSearchParams();
  if (filters.deal_id) params.set("deal_id", filters.deal_id);
  if (filters.lead_id) params.set("lead_id", filters.lead_id);
  if (filters.view) params.set("view", filters.view);
  const res = await fetch(`/api/sales-funnel/activities?${params.toString()}`);
  if (!res.ok) await parseError(res, "Gagal memuat aktivitas");
  const body = (await res.json()) as { data: SalesActivity[] };
  return body.data;
}

export async function createActivity(
  parent: { deal_id?: string; lead_id?: string },
  values: ActivityFormValues
) {
  const res = await fetch("/api/sales-funnel/activities", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...parent,
      activity_type: values.activity_type,
      notes: values.notes || null,
      due_at: localInputToIso(values.due_at),
      is_done: values.is_done,
    }),
  });
  if (!res.ok) await parseError(res, "Gagal mencatat aktivitas");
  return res.json();
}

export async function updateActivity(
  id: string,
  values: Partial<{ is_done: boolean; notes: string | null; due_at: string | null }>
) {
  const res = await fetch(`/api/sales-funnel/activities/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(values),
  });
  if (!res.ok) await parseError(res, "Gagal memperbarui aktivitas");
  return res.json();
}

export async function deleteActivity(id: string) {
  const res = await fetch(`/api/sales-funnel/activities/${id}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 204) {
    await parseError(res, "Gagal menghapus aktivitas");
  }
}

export async function fetchWaTemplates(): Promise<WaTemplate[]> {
  const res = await fetch("/api/sales-funnel/wa-templates");
  if (!res.ok) await parseError(res, "Gagal memuat template pesan");
  const body = (await res.json()) as { data: WaTemplate[] };
  return body.data;
}

export async function createWaTemplate(values: { name: string; body: string }) {
  const res = await fetch("/api/sales-funnel/wa-templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(values),
  });
  if (!res.ok) await parseError(res, "Gagal membuat template");
  return res.json();
}

export async function updateWaTemplate(
  id: string,
  values: Partial<{ name: string; body: string }>
) {
  const res = await fetch(`/api/sales-funnel/wa-templates/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(values),
  });
  if (!res.ok) await parseError(res, "Gagal memperbarui template");
  return res.json();
}

export async function deleteWaTemplate(id: string) {
  const res = await fetch(`/api/sales-funnel/wa-templates/${id}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 204) {
    await parseError(res, "Gagal menghapus template");
  }
}

export async function sendDealWa(
  dealId: string,
  payload: { template_id?: string; message?: string }
): Promise<{ message?: string }> {
  const res = await fetch(`/api/sales-funnel/deals/${dealId}/send-wa`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) await parseError(res, "Gagal mengirim WA");
  return res.json();
}
