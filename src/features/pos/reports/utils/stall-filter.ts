/**
 * Nilai filter stall di form laporan: user yang dikunci ke satu stall
 * (stall_locked) otomatis memakai stall dari server bila belum memilih.
 */
export function stallFilterValue(
  picked: string,
  report: { stall_locked?: boolean; filters: { warehouse_id?: string | null } } | null | undefined
): string {
  if (picked) return picked;
  return report?.stall_locked ? report.filters.warehouse_id || "" : "";
}
