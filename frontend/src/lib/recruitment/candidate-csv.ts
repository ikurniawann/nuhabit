import { formatDate } from "@/lib/format";
import { CANDIDATE_STATUS_LABELS } from "./status";
import { CANDIDATE_SOURCE_LABELS } from "./candidate-query";

/**
 * Sel CSV: kutip ganda di-escape, dan nilai yang diawali = + - @ (atau
 * tab/CR) diberi awalan ' supaya spreadsheet tidak menjalankannya sebagai
 * formula. Data kandidat berasal dari form karir publik.
 */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export const toCsv = (rows: unknown[][]) => rows.map((r) => r.map(csvCell).join(",")).join("\n");

export interface CandidateCsvRow {
  full_name: string;
  email: string;
  phone: string;
  domicile: string;
  status: string;
  source: string;
  created_at: string;
  brands: { name: string } | null;
  positions: { title: string } | null;
}

const label = (labels: Record<string, string>, key: string) => labels[key] ?? key;

/** CSV halaman Kandidat (kolom lengkap kontak). */
export const candidatesCsv = (candidates: CandidateCsvRow[]) =>
  toCsv([
    ["Nama", "Email", "Telepon", "Domisili", "Posisi", "Brand", "Status", "Sumber", "Tanggal"],
    ...candidates.map((c) => [
      c.full_name,
      c.email,
      c.phone,
      c.domicile,
      c.positions?.title,
      c.brands?.name,
      label(CANDIDATE_STATUS_LABELS, c.status),
      label(CANDIDATE_SOURCE_LABELS, c.source),
      formatDate(c.created_at),
    ]),
  ]);

/** CSV ringkas dashboard rekrutmen. */
export const recruitmentDashboardCsv = (candidates: CandidateCsvRow[]) =>
  toCsv([
    ["Nama", "Posisi", "Brand", "Status", "Sumber", "Tanggal Lamar"],
    ...candidates.map((c) => [
      c.full_name,
      c.positions?.title,
      c.brands?.name,
      c.status,
      c.source,
      formatDate(c.created_at, ""),
    ]),
  ]);
