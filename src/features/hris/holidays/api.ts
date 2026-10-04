import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api-client";
import type { HolidayImportItem, HolidayImportRow, HolidayPayload, HolidayRow } from "./types";

export const fetchHolidays = (year: number) =>
  apiGet<{ data: HolidayRow[] }>(`/api/hris/holidays?year=${year}&include_draft=1`).then(
    (res) => res.data ?? []
  );

export const fetchHolidayImportPreview = (year: number) =>
  apiGet<{ data: HolidayImportRow[] }>(`/api/hris/holidays/import?year=${year}`).then(
    (res) => res.data ?? []
  );

export const saveHoliday = (payload: HolidayPayload, id?: string) =>
  id ? apiPatch(`/api/hris/holidays/${id}`, payload) : apiPost("/api/hris/holidays", payload);

export const deleteHoliday = (id: string) => apiDelete(`/api/hris/holidays/${id}`);

export const importHolidays = (items: HolidayImportItem[]) =>
  apiPost<{ message?: string }>("/api/hris/holidays/import", { items });
