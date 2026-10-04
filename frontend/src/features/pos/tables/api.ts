import type { PosTablePayload, PosTableRow } from "./types";

async function parseJson<T>(res: Response): Promise<T> {
  const json = (await res.json()) as T & { success?: boolean; error?: string };
  if (!res.ok || (json as { success?: boolean }).success === false) {
    throw new Error(
      (json as { error?: string }).error || `Request failed (${res.status})`
    );
  }
  return json;
}

export async function listPosTables(includeInactive = true): Promise<PosTableRow[]> {
  const qs = includeInactive ? "?include_inactive=true" : "";
  const res = await fetch(`/api/pos/tables${qs}`, { credentials: "include" });
  const json = await parseJson<{ data: PosTableRow[] }>(res);
  return json.data || [];
}

export async function createPosTable(body: PosTablePayload) {
  const res = await fetch("/api/pos/tables", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseJson<{ data: PosTableRow; message?: string }>(res);
}

export async function updatePosTable(id: string, body: PosTablePayload) {
  const res = await fetch(`/api/pos/tables/${id}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseJson<{ data: PosTableRow; message?: string }>(res);
}

export async function deletePosTable(id: string) {
  const res = await fetch(`/api/pos/tables/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  return parseJson<{ message?: string }>(res);
}

export async function patchPosTablePosition(
  id: string,
  pos: { pos_x: number; pos_y: number }
) {
  const res = await fetch(`/api/pos/tables/${id}/position`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(pos),
  });
  return parseJson<{
    data: { id: string; pos_x: number; pos_y: number };
    message?: string;
  }>(res);
}
