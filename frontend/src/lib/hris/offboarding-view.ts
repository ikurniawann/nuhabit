/**
 * Label & aturan tampilan halaman offboarding (resignasi) karyawan.
 */

export const RESIGNATION_TYPE_LABELS: Record<string, string> = {
  voluntary: "Mengundurkan Diri",
  termination: "PHK",
  layoff: "Layoff",
  end_of_contract: "Akhir Kontrak",
};

export const OFFBOARDING_STATUS_OPTIONS = [
  { value: "submitted", label: "Submitted" },
  { value: "notice_period", label: "Notice Period" },
  { value: "exit_interview", label: "Exit Interview" },
  { value: "completed", label: "Completed" },
] as const;

export const OFFBOARDING_ASSETS = [
  { key: "laptop", label: "Laptop" },
  { key: "id_card", label: "Kartu ID" },
  { key: "access_card", label: "Kartu Akses" },
  { key: "keys", label: "Kunci" },
  { key: "phone", label: "Handphone Kantor" },
  { key: "other", label: "Lainnya" },
] as const;

export const OFFBOARDING_CLEARANCES = [
  { key: "hrd", label: "HRD Clearance" },
  { key: "it", label: "IT Clearance" },
  { key: "finance", label: "Finance Clearance" },
  { key: "manager", label: "Manager Clearance" },
] as const;

export type ClearanceKey = (typeof OFFBOARDING_CLEARANCES)[number]["key"];
export type ClearanceFlags = Readonly<Record<`clearance_${ClearanceKey}`, boolean>>;

export function resignationTypeLabel(type: string): string {
  return RESIGNATION_TYPE_LABELS[type] || type;
}

export function isCleared(record: ClearanceFlags, key: ClearanceKey): boolean {
  return Boolean(record[`clearance_${key}` as const]);
}

/** Status pengembalian aset baru setelah satu aset dicentang/dibatalkan. */
export function withAssetReturn(
  current: Record<string, boolean> | null | undefined,
  asset: string,
  returned: boolean
): Record<string, boolean> {
  return { ...current, [asset]: returned };
}
