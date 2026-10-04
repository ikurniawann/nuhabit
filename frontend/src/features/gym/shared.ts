/** Select native bergaya pill untuk form gym. */
export const SELECT =
  "h-10 w-full rounded-full border border-border bg-card px-4 text-sm text-foreground outline-none focus-visible:border-forest";

/** Fetch API gym staf: `{ success, data }` → data; selain itu Error berisi json.error. */
export async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) throw new Error(json.error || "Permintaan gagal");
  return json.data as T;
}

export const send = <T>(url: string, body: unknown, method = "POST") =>
  call<T>(url, { method, body: JSON.stringify(body) });
export const remove = <T>(url: string) => call<T>(url, { method: "DELETE" });
