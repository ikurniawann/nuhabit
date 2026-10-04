import type { ItemsLookupRecord } from "@/lib/purchasing/items-lookup";

const LEGACY_CATEGORY_LABELS: Record<string, string> = {
  BAHAN_PANGAN: "Food Material",
  BAHAN_NON_PANGAN: "Non-Food Material",
  KEMASAN: "Packaging",
  BAHAN_BAKAR: "Fuel Material",
  LAINNYA: "Other",
};

export interface ItemsLookupRecordWithScope extends ItemsLookupRecord {
  company_id?: string | null;
}

function dedupeLookupRecordsByCode(
  records: ItemsLookupRecord[] | undefined
): ItemsLookupRecord[] {
  const byCode = new Map<string, ItemsLookupRecordWithScope>();

  for (const row of records ?? []) {
    if (!row.is_active) continue;

    const code = row.code.trim().toUpperCase();
    const scopedRow = row as ItemsLookupRecordWithScope;
    const existing = byCode.get(code);

    if (!existing) {
      byCode.set(code, scopedRow);
      continue;
    }

    // Prefer company-scoped rows over global templates (company_id IS NULL).
    if (!existing.company_id && scopedRow.company_id) {
      byCode.set(code, scopedRow);
    }
  }

  return Array.from(byCode.values()).sort((a, b) => a.nama.localeCompare(b.nama));
}

export function toLookupOptions(records: ItemsLookupRecord[] | undefined) {
  return dedupeLookupRecordsByCode(records).map((row) => ({
    value: row.code,
    label: row.nama,
    description: row.deskripsi || undefined,
  }));
}

export function buildLookupLabelMap(records: ItemsLookupRecord[] | undefined) {
  const map = new Map<string, string>();
  for (const row of dedupeLookupRecordsByCode(records)) {
    map.set(row.code, row.nama);
  }
  return map;
}

export function resolveCategoryLabel(
  code: string | null | undefined,
  categoryMap?: Map<string, string>
) {
  if (!code) return "-";
  return categoryMap?.get(code) ?? LEGACY_CATEGORY_LABELS[code] ?? code.replace(/_/g, " ");
}
