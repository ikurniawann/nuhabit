/** Perbandingan before/after baris audit (aman dipakai di client). */

export interface AuditDiffRow {
  field: string;
  before: unknown;
  after: unknown;
}

/** Field yang berubah antara before dan after (untuk tampilan detail). */
export function diffAudit(before: unknown, after: unknown): AuditDiffRow[] {
  const asRecord = (value: unknown): Record<string, unknown> =>
    value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const b = asRecord(before);
  const a = asRecord(after);
  const fields = Array.from(new Set([...Object.keys(b), ...Object.keys(a)])).sort();
  return fields
    .filter((field) => JSON.stringify(b[field]) !== JSON.stringify(a[field]))
    .map((field) => ({ field, before: b[field] ?? null, after: a[field] ?? null }));
}
