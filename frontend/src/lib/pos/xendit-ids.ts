export function sanitizeXenditRef(value?: string | null) {
  const trimmed = String(value || "").trim();
  if (!trimmed || trimmed.length > 128) return null;
  return trimmed;
}
