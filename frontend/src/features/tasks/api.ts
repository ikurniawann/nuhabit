import { apiDelete, apiGet, apiPatch, apiPost, buildListUrl } from "@/lib/api-client";
import type {
  ContributionSummary,
  CreateTaskPayload,
  KpiTasksView,
  MonitorData,
  OccurrenceAction,
  TaskAttachment,
  TaskDetail,
  TaskItem,
  TaskListFilter,
  TaskMeta,
  TaskPatch,
} from "./types";

const BASE = "/api/hris/dept-tasks";

type Envelope<T> = { data: T };

const unwrap = <T>(p: Promise<Envelope<T>>) => p.then((r) => r.data);

export const fetchTaskMeta = () => unwrap(apiGet<Envelope<TaskMeta>>(`${BASE}/meta`));

export const fetchTaskItems = (filter: TaskListFilter) =>
  unwrap(apiGet<Envelope<TaskItem[]>>(buildListUrl(`${BASE}/items`, { ...filter })));

export const fetchOccurrence = (id: string) => unwrap(apiGet<Envelope<TaskDetail>>(`${BASE}/occurrences/${id}`));

export const createTask = (payload: CreateTaskPayload) =>
  apiPost<{ message: string; data: { id: string } }>(BASE, payload);

export const patchTask = (id: string, patch: TaskPatch) => apiPatch<{ message: string }>(`${BASE}/${id}`, patch);

export const occurrenceAction = (id: string, body: OccurrenceAction) =>
  apiPatch<{ message?: string; data?: { progress: number; complete: boolean } }>(`${BASE}/occurrences/${id}`, body);

/** Unggah multipart; browser mengisi Content-Type beserta boundary. */
export async function uploadAttachment(occurrenceId: string, file: File): Promise<TaskAttachment> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${BASE}/occurrences/${occurrenceId}/attachments`, { method: "POST", body: form });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Unggahan gagal");
  return json.data as TaskAttachment;
}

export const attachmentUrl = (occurrenceId: string, attachmentId: string, inline = false) =>
  `${BASE}/occurrences/${occurrenceId}/attachments/${attachmentId}${inline ? "?inline=1" : ""}`;

export const deleteAttachment = (occurrenceId: string, attachmentId: string) =>
  apiDelete(`${BASE}/occurrences/${occurrenceId}/attachments/${attachmentId}`);

export const fetchKpiTasks = (params: { department_id?: string; month?: string }) =>
  unwrap(apiGet<Envelope<KpiTasksView>>(buildListUrl(`${BASE}/kpi`, params)));

export const fetchContributions = (params: { employee_id: string; month: string }) =>
  unwrap(apiGet<Envelope<ContributionSummary[]>>(buildListUrl(`${BASE}/kpi/contributions`, params)));

export const fetchMonitor = (params: { department_id?: string; month: string }) =>
  unwrap(apiGet<Envelope<MonitorData>>(buildListUrl(`${BASE}/monitor`, params)));
