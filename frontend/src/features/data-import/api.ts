/** Klien impor CSV/XLSX: unggah ke endpoint impor Go, dry run dulu, lalu commit. */

export type ImportRowStatus = "created" | "updated" | "unchanged" | "skipped" | "error";

export interface ImportRow {
  row: number;
  status: ImportRowStatus;
  label: string;
  message?: string;
}

/** Laporan satu kali jalan (platform/importer.Report di Go). */
export interface ImportReport {
  dry_run: boolean;
  total: number;
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  failed: number;
  rows: ImportRow[];
  errors: Array<{ row: number; message: string }>;
}

export const ROW_STATUS_LABEL: Record<ImportRowStatus, string> = {
  created: "Baru",
  updated: "Diperbarui",
  unchanged: "Tidak berubah",
  skipped: "Dilewati",
  error: "Gagal",
};

/** Unggah file ke endpoint impor; dryRun hanya memvalidasi dan melaporkan. */
export async function importFile(endpoint: string, file: File, dryRun: boolean): Promise<ImportReport> {
  const body = new FormData();
  body.append("file", file);
  if (dryRun) body.append("dry_run", "1");
  const res = await fetch(endpoint, { method: "POST", body, cache: "no-store" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) throw new Error(json.error || "Impor gagal");
  return json.data as ImportReport;
}

/** Ringkasan satu baris: "3 baru, 2 diperbarui, 1 gagal". Bagian nol tidak ditulis. */
export function summarize(report: ImportReport): string {
  const parts = [
    [report.created, "baru"],
    [report.updated, "diperbarui"],
    [report.unchanged, "tidak berubah"],
    [report.skipped, "dilewati"],
    [report.failed, "gagal"],
  ] as const;
  const text = parts
    .filter(([n]) => n > 0)
    .map(([n, label]) => `${n} ${label}`)
    .join(", ");
  return text || "Tidak ada baris";
}

/** Jumlah baris yang akan ditulis bila laporan dry run ini di-commit. */
export function writableRows(report: ImportReport): number {
  return report.created + report.updated;
}
