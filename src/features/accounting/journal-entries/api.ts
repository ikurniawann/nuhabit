import { apiGet, apiPost, apiPut, apiDelete, buildListUrl } from "@/lib/api-client";
import type {
  JournalEntryItem,
  JournalEntryListFilters,
  JournalEntryPayload,
} from "@/lib/accounting/types";

const BASE = "/api/accounting/journal-entries";

export const fetchJournalEntryList = (filters?: JournalEntryListFilters) =>
  apiGet<{ data: JournalEntryItem[] }>(
    buildListUrl(
      BASE,
      filters as Record<string, string | number | boolean | null | undefined>
    )
  ).then((res) => res.data);

export const fetchJournalEntry = (id: string) =>
  apiGet<{ data: JournalEntryItem }>(`${BASE}/${id}`).then((res) => res.data);

export const createJournalEntry = (body: JournalEntryPayload) =>
  apiPost<{ data: JournalEntryItem; message?: string }>(BASE, body);

export const updateJournalEntry = (id: string, body: JournalEntryPayload) =>
  apiPut<{ data: JournalEntryItem; message?: string }>(`${BASE}/${id}`, body);

export const postJournalEntryApi = (id: string) =>
  apiPost<{ data: JournalEntryItem; message?: string }>(
    `${BASE}/${id}/post`,
    {}
  );

export const deleteJournalEntry = (id: string) => apiDelete(`${BASE}/${id}`);
