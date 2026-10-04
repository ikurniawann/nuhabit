/**
 * fetch JSON untuk portal kandidat (psikotes, interview, offer). Respons
 * non-2xx dilempar sebagai Error berisi `error` dari server supaya pesan
 * berbahasa Indonesia tampil apa adanya ke kandidat.
 */
export async function portalRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const json: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = typeof json === "object" && json !== null ? (json as { error?: unknown }).error : undefined;
    throw new Error(error != null ? String(error) : `Permintaan gagal (${res.status})`);
  }
  return json as T;
}

/** RequestInit untuk body JSON. */
export function jsonBody(method: "POST" | "PUT", body: unknown, extra?: RequestInit): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), ...extra };
}
