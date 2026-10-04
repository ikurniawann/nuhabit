/**
 * Draft form Konfigurasi KPI per departemen: suntingan lokal menimpa mapping
 * tersimpan; indikator tanpa mapping = tidak aktif dengan bobot default 10.
 */

export interface ConfigDraftItem {
  enabled: boolean;
  weight: string;
}

export type ConfigDraft = Record<string, ConfigDraftItem>;

const DEFAULT_ITEM: ConfigDraftItem = { enabled: false, weight: "10" };

export function buildConfigDraft(
  indicatorIds: readonly string[],
  mappings: readonly { department_id: string; indicator_id: string; weight: number | string }[],
  departmentId: string,
  edits: Record<string, ConfigDraftItem> | undefined
): ConfigDraft {
  const draft: ConfigDraft = {};
  for (const id of indicatorIds) {
    const found = mappings.find((m) => m.department_id === departmentId && m.indicator_id === id);
    draft[id] =
      edits?.[id] ??
      (found ? { enabled: true, weight: String(Math.round(Number(found.weight))) } : DEFAULT_ITEM);
  }
  return draft;
}

/** Jumlah bobot indikator yang dicentang. */
export function activeWeightTotal(draft: ConfigDraft): number {
  return Object.values(draft)
    .filter((item) => item.enabled)
    .reduce((sum, item) => sum + (Number(item.weight) || 0), 0);
}

/** Payload PUT /api/hris/kpi-config untuk satu departemen. */
export function configPayloadItems(indicatorIds: readonly string[], draft: ConfigDraft) {
  return indicatorIds.map((id) => ({
    indicator_id: id,
    enabled: draft[id]?.enabled ?? false,
    weight: Number(draft[id]?.weight) || 0,
  }));
}
