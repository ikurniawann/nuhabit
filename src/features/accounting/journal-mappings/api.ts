import { apiGet, apiPost, apiPut, apiDelete, buildListUrl } from "@/lib/api-client";
import type {
  JournalMappingItem,
  JournalMappingListFilters,
  JournalMappingPayload,
} from "@/lib/accounting/types";

const BASE = "/api/accounting/journal-mappings";

export const fetchJournalMappingList = (filters?: JournalMappingListFilters) =>
  apiGet<{ data: JournalMappingItem[] }>(
    buildListUrl(
      BASE,
      filters as Record<string, string | number | boolean | null | undefined>
    )
  ).then((res) => res.data);

export const fetchJournalMapping = (id: string) =>
  apiGet<{ data: JournalMappingItem }>(`${BASE}/${id}`).then((res) => res.data);

export const createJournalMapping = (body: JournalMappingPayload) =>
  apiPost<{ data: JournalMappingItem; message?: string }>(BASE, body);

export const updateJournalMapping = (id: string, body: JournalMappingPayload) =>
  apiPut<{ data: JournalMappingItem; message?: string }>(`${BASE}/${id}`, body);

export const deleteJournalMapping = (id: string) =>
  apiDelete(`${BASE}/${id}`);
