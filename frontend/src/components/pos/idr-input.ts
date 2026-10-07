/** Digits only from a possibly formatted amount string. */
export function parseIdrDigits(value: string): number {
  const digits = value.replace(/\D/g, "");
  return digits ? Number(digits) : 0;
}

/** Format integer IDR with thousand separators (id-ID), e.g. 500000 → "500.000". */
export function formatIdrInput(value: string | number): string {
  const n =
    typeof value === "number" ? value : parseIdrDigits(String(value));
  if (!n) return "";
  return n.toLocaleString("id-ID");
}
