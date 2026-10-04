/**
 * Pesan galat dari body JSON API. Rute yang sudah dimigrasi mengirim
 * `{ success: false, error }` (string); rute lama memakai `error.message` atau `message`.
 */
export function apiErrorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback;
  const { error, message } = body as { error?: unknown; message?: unknown };
  if (typeof error === "string" && error) return error;
  if (error && typeof error === "object") {
    const nested = (error as { message?: unknown }).message;
    if (typeof nested === "string" && nested) return nested;
  }
  if (typeof message === "string" && message) return message;
  return fallback;
}
