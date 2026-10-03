/**
 * Panggil API admin CRM yang menjawab `{ success, data, message?, error? }`.
 * Galat server diteruskan sebagai Error berpesan.
 */
export async function crmFetch<T>(url: string, init?: RequestInit): Promise<{ data: T; message?: string }> {
  const res = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) throw new Error(json.error || "Permintaan gagal");
  return { data: json.data as T, message: json.message };
}
