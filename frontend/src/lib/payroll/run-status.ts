/**
 * Aturan siklus hidup run payroll (EPIC-008) — murni & teruji.
 * Transisi sah hanya maju: draft → processing → completed → paid.
 */

export type PayrollRunStatus = "draft" | "processing" | "completed" | "paid";

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  draft: ["processing"],
  processing: ["completed"],
  completed: ["paid"],
  paid: [],
};

export function canTransitionRunStatus(from: string, to: string): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

/** Run yang sudah dibayar adalah catatan finansial final — tak bisa dihapus. */
export function canDeleteRun(status: string): boolean {
  return status !== "paid";
}

/** Kalkulasi hanya boleh pada draft (hasil lama dibuang lalu dihitung ulang). */
export function canCalculateRun(status: string): boolean {
  return status === "draft";
}
