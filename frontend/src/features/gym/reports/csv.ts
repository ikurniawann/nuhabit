/** Kolom tabel laporan: satu definisi untuk tabel di layar dan berkas CSV-nya. */
import type { ReactNode } from "react";
import { convertToCSV } from "@/lib/utils/csv-export";

export interface ReportColumn<T> {
  label: string;
  /** Nilai mentah untuk CSV (angka tanpa format). */
  value: (row: T) => string | number | null;
  /** Isi sel di layar; default value() apa adanya. */
  render?: (row: T) => ReactNode;
  numeric?: boolean;
}

/** Teks CSV dari baris dan kolom laporan; header memakai label kolom. */
export function tableCsv<T>(rows: T[], columns: ReportColumn<T>[]): string {
  const records = rows.map((row) => Object.fromEntries(columns.map((c, i) => [`c${i}`, c.value(row)])));
  return convertToCSV(records, columns.map((c, i) => ({ key: `c${i}`, label: c.label })));
}

/** Nama berkas CSV: laporan-gym-<tabel>-<dari>-<sampai>.csv */
export function csvFilename(table: string, from: string, to: string): string {
  return `laporan-gym-${table}-${from}-${to}.csv`;
}

/** Rasio 0..1 sebagai persen satu desimal (0.225 → 22.5). */
export function percent(ratio: number): number {
  return Math.round(ratio * 1000) / 10;
}
