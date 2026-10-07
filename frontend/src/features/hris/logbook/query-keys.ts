import type { LogbookEntriesParams, LogbookTemplatesParams } from "./types";

export const logbookQueryKeys = {
  all: ["hris", "logbook"] as const,
  me: () => ["hris", "logbook", "me"] as const,
  departments: () => ["hris", "logbook", "departments"] as const,
  templates: (params?: LogbookTemplatesParams) =>
    ["hris", "logbook", "templates", params ?? {}] as const,
  entries: (params?: LogbookEntriesParams) =>
    ["hris", "logbook", "entries", params ?? {}] as const,
  summary: (params?: { department_id?: string }) =>
    ["hris", "logbook", "summary", params ?? {}] as const,
};
