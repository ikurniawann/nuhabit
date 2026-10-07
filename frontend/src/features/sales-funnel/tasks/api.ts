import { parseError } from "../api-error";
import type { SalesTask, TaskFilters, TaskFormValues, TaskSubjectRef } from "./types";
import { formToPayload } from "./types";

export async function fetchTasks(filters: TaskFilters): Promise<SalesTask[]> {
  const params = new URLSearchParams();
  if (filters.view && filters.view !== "all") params.set("view", filters.view);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.status) params.set("status", filters.status);
  if (filters.priority) params.set("priority", filters.priority);
  if (filters.owner_user_id) params.set("owner_user_id", filters.owner_user_id);
  if (filters.subject_type && filters.subject_id) {
    params.set("subject_type", filters.subject_type);
    params.set("subject_id", filters.subject_id);
  }
  const res = await fetch(`/api/sales-funnel/activities?${params.toString()}`);
  if (!res.ok) await parseError(res, "Gagal memuat tasks");
  const body = (await res.json()) as { data: SalesTask[] };
  return body.data;
}

export async function createTask(subject: TaskSubjectRef, values: TaskFormValues) {
  const res = await fetch("/api/sales-funnel/activities", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      subject_type: subject.subject_type,
      subject_id: subject.subject_id,
      ...formToPayload(values),
    }),
  });
  if (!res.ok) await parseError(res, "Gagal membuat task");
  return res.json();
}

export async function updateTask(
  id: string,
  values: Partial<ReturnType<typeof formToPayload>> & { is_done?: boolean }
) {
  const res = await fetch(`/api/sales-funnel/activities/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(values),
  });
  if (!res.ok) await parseError(res, "Gagal memperbarui task");
  return res.json() as Promise<{ data: { next_task_id?: string | null }; message?: string }>;
}

export async function deleteTask(id: string) {
  const res = await fetch(`/api/sales-funnel/activities/${id}`, { method: "DELETE" });
  if (!res.ok && res.status !== 204) await parseError(res, "Gagal menghapus task");
}
