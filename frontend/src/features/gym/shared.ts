/** Select native bergaya pill untuk form gym. */
export const SELECT =
  "h-10 w-full rounded-full border border-border bg-card px-4 text-sm text-foreground outline-none focus-visible:border-forest";

/** Error API gym: pesan json.error dan details.code (mis. SHIFT_REQUIRED). */
export class GymApiError extends Error {
  constructor(
    message: string,
    readonly code?: string
  ) {
    super(message);
    this.name = "GymApiError";
  }
}

/** Fetch API gym staf: `{ success, data }` → data; selain itu GymApiError berisi json.error. */
export async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) throw new GymApiError(json.error || "Permintaan gagal", json.details?.code);
  return json.data as T;
}

export const send = <T>(url: string, body: unknown, method = "POST") =>
  call<T>(url, { method, body: JSON.stringify(body) });

/** POST multipart; browser yang mengisi Content-Type beserta boundary-nya. */
export async function upload<T>(url: string, body: FormData): Promise<T> {
  const res = await fetch(url, { method: "POST", body, cache: "no-store" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) throw new Error(json.error || "Unggahan gagal");
  return json.data as T;
}
export const remove = <T>(url: string) => call<T>(url, { method: "DELETE" });
