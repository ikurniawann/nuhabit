export const BASE = "/api/purchasing";

interface ApiErrorBody {
  errors?: Record<string, unknown>;
  message?: string;
  error?: string;
}

/** fetch JSON ke API purchasing; galat dilempar dengan pesan field/`message`/`error` dari server. */
export async function fetchApi<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  if (!response.ok) {
    const error: ApiErrorBody = await response.json().catch(() => ({}));
    const fieldErrors =
      error.errors && typeof error.errors === "object"
        ? Object.values(error.errors).flat().filter(Boolean).join(", ")
        : "";
    throw new Error(fieldErrors || error.message || error.error || `HTTP ${response.status}`);
  }

  return response.json();
}
