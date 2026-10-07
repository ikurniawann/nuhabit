/** Next.js redirect/notFound throw special errors — must not be swallowed. */
export function isNextControlFlowError(error: unknown): boolean {
  const digest =
    typeof error === "object" && error && "digest" in error
      ? String((error as { digest?: unknown }).digest || "")
      : "";
  const message = error instanceof Error ? error.message : "";
  return (
    digest.startsWith("NEXT_REDIRECT") ||
    digest.startsWith("NEXT_NOT_FOUND") ||
    digest.startsWith("NEXT_HTTP_ERROR_FALLBACK") ||
    message.includes("NEXT_REDIRECT") ||
    message.includes("NEXT_NOT_FOUND")
  );
}

export function getSafeErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) {
    if (error.message.startsWith("An error occurred in the Server Components render")) {
      return fallback;
    }
    return error.message;
  }
  return fallback;
}
