/**
 * Klien data aplikasi member. Semua permintaan ke /api/member-portal/* di
 * origin sendiri; sesi member ikut lewat cookie `member_session`. Respons
 * `{ success, data, error }` dibuka di sini supaya hook cukup memakai `data`.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function memberApi<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, headers, ...rest } = init ?? {};
  const res = await fetch(`/api/member-portal${path}`, {
    credentials: "same-origin",
    ...rest,
    headers: json === undefined ? headers : { "Content-Type": "application/json", ...headers },
    body: json === undefined ? rest.body : JSON.stringify(json),
  });
  const payload = (await res.json().catch(() => null)) as { success?: boolean; data?: T; error?: string } | null;
  if (!res.ok || payload?.success === false) {
    throw new ApiError(res.status, payload?.error ?? `Permintaan gagal (${res.status})`);
  }
  return payload?.data as T;
}
