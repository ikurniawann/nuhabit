import { apiDelete, apiGet, apiPatch, apiPost, buildListUrl } from "@/lib/api-client";
import type {
  LogbookCurrentUser,
  LogbookDepartment,
  LogbookTemplate,
  LogbookTemplatesParams,
  LogbookEntriesParams,
  LogbookEntriesResult,
  LogbookSummaryRow,
  CreateLogbookTemplatePayload,
  CreateLogbookEntryPayload,
  UpdateLogbookItemPayload,
  UpdateLogbookEntryStatusPayload,
} from "./types";

const BASE = "/api/hris/logbook";

export const fetchLogbookMe = () =>
  apiGet<{ data: LogbookCurrentUser | null }>(`${BASE}?resource=me`).then(
    (res) => res.data
  );

export const fetchLogbookDepartments = () =>
  apiGet<{ data: LogbookDepartment[] }>(`${BASE}?resource=departments`).then(
    (res) => res.data
  );

export const fetchLogbookTemplates = (params?: LogbookTemplatesParams) =>
  apiGet<{ data: LogbookTemplate[] }>(
    buildListUrl(BASE, {
      resource: "templates",
      department_id: params?.department_id,
      include_inactive: params?.include_inactive ? "true" : undefined,
    })
  ).then((res) => res.data);

export const fetchLogbookEntries = (params?: LogbookEntriesParams) =>
  apiGet<LogbookEntriesResult>(
    buildListUrl(BASE, { resource: "entries", ...(params ?? {}) })
  );

export const fetchLogbookSummary = (params?: { department_id?: string }) =>
  apiGet<{ data: LogbookSummaryRow[] }>(
    buildListUrl(BASE, { resource: "summary", ...(params ?? {}) })
  ).then((res) => res.data);

export const createLogbookTemplate = (payload: CreateLogbookTemplatePayload) =>
  apiPost<{ data?: unknown }>(BASE, { action: "create-template", ...payload });

export const createLogbookEntry = (payload: CreateLogbookEntryPayload) =>
  apiPost<{ data?: { id?: string } }>(BASE, { action: "create-entry", ...payload });

export const updateLogbookItem = (payload: UpdateLogbookItemPayload) =>
  apiPatch<{ data?: unknown }>(BASE, { action: "update-item", ...payload });

export const updateLogbookEntryStatus = (payload: UpdateLogbookEntryStatusPayload) =>
  apiPatch<{ data?: unknown }>(BASE, payload);

export const deleteLogbookEntry = (entryId: string) =>
  apiDelete(buildListUrl(BASE, { resource: "entry", id: entryId }));

export const deleteLogbookTemplate = (templateId: string) =>
  apiDelete(buildListUrl(BASE, { resource: "template", id: templateId })) as Promise<{
    message?: string;
    archived?: boolean;
  }>;
