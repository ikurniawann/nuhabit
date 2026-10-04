/**
 * Bagian bersama impor/ekspor master purchasing (bahan baku, produk, supplier,
 * satuan): baca CSV/XLSX jadi matriks, normalisasi header, parser sel, ringkasan.
 */
import { buildXlsxBuffer, parseXlsxToMatrix } from "@/lib/spreadsheet/exceljs-safe";

/** CSV sederhana: koma sebagai pemisah, tanda kutip membungkus koma. Baris kosong dibuang. */
export function parseCsvMatrix(text: string): string[][] {
  const lines = text.split("\n").filter((line) => line.trim());
  return lines.map((line) => {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;

    for (const char of line) {
      if (char === '"') inQuotes = !inQuotes;
      else if (char === "," && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else current += char;
    }
    result.push(current.trim());
    return result;
  });
}

export function spreadsheetCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);
  return String(value).trim();
}

/** .csv dibaca sebagai teks UTF-8, selain itu sebagai .xlsx. */
export async function parseSpreadsheetMatrix(buffer: Buffer, fileName: string): Promise<string[][]> {
  if (fileName.toLowerCase().endsWith(".csv")) {
    return parseCsvMatrix(buffer.toString("utf-8"));
  }
  const rows = await parseXlsxToMatrix(buffer);
  return rows.map((row) => row.map((cell) => spreadsheetCell(cell)));
}

/** "Nama Supplier" → "nama_supplier", lalu alias (mis. "name" → "nama_supplier"). */
export function createHeaderNormalizer(aliases: Record<string, string>) {
  return (header: string) => {
    const key = header.toLowerCase().replace(/\s+/g, "_");
    return aliases[key] || key;
  };
}

/** Workbook satu sheet: baris header = `headers`, isi diambil per key. */
export function buildSingleSheetWorkbook(
  sheetName: string,
  headers: string[],
  rows: Record<string, unknown>[]
): Promise<Buffer> {
  const sheetRows = [headers, ...rows.map((row) => headers.map((key) => spreadsheetCell(row[key])))];
  return buildXlsxBuffer([{ name: sheetName, rows: sheetRows }]);
}

export type ImportRow = { rowNumber: number; data: Record<string, string> };

/** Matriks → baris ber-key header. rowNumber mengikuti nomor baris di file (header = 1). */
export function matrixToRows(matrix: string[][], normalizeHeader: (header: string) => string): ImportRow[] {
  const headers = matrix[0].map(normalizeHeader);
  return matrix.slice(1).map((cells, index) => {
    const data: Record<string, string> = {};
    headers.forEach((header, idx) => {
      data[header] = cells[idx] || "";
    });
    return { rowNumber: index + 2, data };
  });
}

export function isBlankRow(data: Record<string, string>, keys: readonly string[]): boolean {
  return keys.every((key) => !data[key]?.trim());
}

/** Angka dengan pemisah ribuan koma ("1,250.5"); kosong/tidak valid → fallback. */
export function parseNumberCell(value: string | undefined, fallback = 0): number {
  if (!value?.trim()) return fallback;
  const parsed = Number(value.replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function parseOptionalIntCell(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function emptyToNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

const INACTIVE_WORDS = ["inactive", "nonaktif", "false", "0", "no"];

/** Status aktif: kosong = aktif; "inactive/nonaktif/false/0/no" = nonaktif. */
export function parseActiveCell(value: string | undefined): boolean {
  if (!value?.trim()) return true;
  return !INACTIVE_WORDS.includes(value.trim().toLowerCase());
}

/** Kode berurutan berikutnya dari kode terakhir ("BHN-2026-0007" → 8). */
export function nextCodeSequence(lastCode: string | null | undefined): number {
  const match = lastCode?.match(/-(\d+)$/);
  return match ? parseInt(match[1], 10) + 1 : 1;
}

/** Penampung hasil impor per baris; bentuk respons dipertahankan dari route lama. */
export class ImportTally {
  imported = 0;
  updated = 0;
  skipped = 0;
  errors: { row: number; message: string }[] = [];

  skip(row: number, message: string): void {
    this.errors.push({ row, message });
    this.skipped += 1;
  }

  summary() {
    return {
      success: true as const,
      imported: this.imported,
      updated: this.updated,
      skipped: this.skipped,
      errors: this.errors,
    };
  }
}
