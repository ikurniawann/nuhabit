import { apiGet, apiPost, apiPut, apiDelete, buildListUrl } from "@/lib/api-client";
import type {
  CoaAccountItem,
  CoaAccountPayload,
  CoaImportResult,
  CoaListFilters,
} from "./types";

const BASE = "/api/accounting/chart-of-accounts";

export const fetchCoaList = (filters?: CoaListFilters) =>
  apiGet<{ data: CoaAccountItem[] }>(
    buildListUrl(BASE, filters as Record<string, string | number | boolean | null | undefined>)
  ).then((res) => res.data);

export const createCoaAccount = (body: CoaAccountPayload) =>
  apiPost<{ data: CoaAccountItem; message?: string }>(BASE, body);

export const updateCoaAccount = (id: string, body: CoaAccountPayload) =>
  apiPut<{ data: CoaAccountItem; message?: string }>(`${BASE}/${id}`, body);

export const deleteCoaAccount = (id: string) => apiDelete(`${BASE}/${id}`);

export async function importCoaFile(file: File, mode: "preview" | "commit") {
  const form = new FormData();
  form.append("file", file);
  form.append("mode", mode);
  const res = await fetch(`${BASE}/import`, { method: "POST", body: form });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      typeof json === "object" && json && "error" in json
        ? String((json as { error?: string }).error)
        : `Import gagal (${res.status})`
    );
  }
  return json as { data: CoaImportResult; message?: string };
}
