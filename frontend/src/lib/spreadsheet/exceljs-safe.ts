/**
 * Pembungkus aman ExcelJS untuk gantikan paket `xlsx` (SheetJS npm) yang
 * terkena prototype pollution (GHSA-4r6h-8v6p-xvw6) & ReDoS
 * (GHSA-5pgg-2g8v-p4x9) tanpa perbaikan di jalur npm (audit 2026-09-17).
 *
 * Fokusnya: satu tempat untuk (a) mem-PARSE file upload dengan BATAS ukuran/
 * baris/kolom, dan (b) MENULIS workbook multi-sheet (lebar kolom + merge).
 * ExcelJS bersifat async, jadi fungsi di sini mengembalikan Promise.
 */

import ExcelJS from "exceljs";

export type SpreadsheetCellValue = string | number | boolean | null | undefined;

/** Merge sel bergaya xlsx (indeks-0), diterjemahkan ke API 1-indeks ExcelJS. */
export interface SheetMerge {
  s: { r: number; c: number };
  e: { r: number; c: number };
}

export interface SheetSpec {
  name: string;
  rows: SpreadsheetCellValue[][];
  /** Lebar kolom dalam satuan karakter (padanan `wch` xlsx). */
  columnWidths?: number[];
  merges?: SheetMerge[];
}

/** Tulis satu/lebih sheet ke buffer .xlsx. */
export async function buildXlsxBuffer(sheets: SheetSpec[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const spec of sheets) {
    const ws = wb.addWorksheet(spec.name || "Sheet1");
    for (const row of spec.rows) {
      ws.addRow(row.map((c) => (c === null || c === undefined ? "" : c)));
    }
    if (spec.columnWidths) {
      spec.columnWidths.forEach((w, i) => {
        if (w && w > 0) ws.getColumn(i + 1).width = w;
      });
    }
    for (const m of spec.merges ?? []) {
      ws.mergeCells(m.s.r + 1, m.s.c + 1, m.e.r + 1, m.e.c + 1);
    }
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export interface ParseLimits {
  /** Tolak sebelum parse bila buffer lebih besar dari ini. */
  maxBytes?: number;
  maxRows?: number;
  maxCols?: number;
}

const DEFAULT_LIMITS: Required<ParseLimits> = {
  maxBytes: 15 * 1024 * 1024,
  maxRows: 100_000,
  maxCols: 512,
};

/** Satu sel ExcelJS → string rapi (tangani rich text, hyperlink, rumus, tanggal). */
export function cellToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (Array.isArray(obj.richText)) {
      return obj.richText.map((part) => String((part as { text?: unknown }).text ?? "")).join("").trim();
    }
    if ("text" in obj) return String(obj.text ?? "").trim();
    if ("result" in obj) return String(obj.result ?? "").trim();
    if ("hyperlink" in obj) return String(obj.hyperlink ?? "").trim();
    return String(value).trim();
  }
  return String(value).trim();
}

/**
 * Parse .xlsx (buffer) → matriks string rektangular (baris pertama = header,
 * sesuai perilaku `sheet_to_json header:1 defval:""` sebelumnya). Sheet dipilih
 * lewat `pickSheet`, default sheet pertama.
 */
export async function parseXlsxToMatrix(
  buffer: Buffer,
  options?: { pickSheet?: (wb: ExcelJS.Workbook) => ExcelJS.Worksheet | undefined; limits?: ParseLimits }
): Promise<string[][]> {
  const lim = { ...DEFAULT_LIMITS, ...(options?.limits ?? {}) };
  if (buffer.length > lim.maxBytes) {
    throw new Error("File spreadsheet terlalu besar untuk diproses");
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const ws = options?.pickSheet ? options.pickSheet(wb) : wb.worksheets[0];
  if (!ws) return [];

  const raw: unknown[][] = [];
  let maxCols = 0;
  ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    if (rowNumber > lim.maxRows) return;
    // row.values 1-indeks (elemen ke-0 selalu undefined) → buang.
    const values = (row.values as unknown[]).slice(1);
    raw.push(values);
    if (values.length > maxCols) maxCols = values.length;
  });
  maxCols = Math.min(maxCols, lim.maxCols);
  return raw.map((row) => Array.from({ length: maxCols }, (_, i) => cellToString(row[i])));
}

/** Semua sheet → CSV per sheet (untuk ekstraksi teks lampiran). */
export async function parseXlsxToCsvParts(buffer: Buffer, limits?: ParseLimits): Promise<Array<{ name: string; csv: string }>> {
  const lim = { ...DEFAULT_LIMITS, ...(limits ?? {}) };
  if (buffer.length > lim.maxBytes) {
    throw new Error("File spreadsheet terlalu besar untuk diproses");
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const parts: Array<{ name: string; csv: string }> = [];
  for (const ws of wb.worksheets) {
    const lines: string[] = [];
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber > lim.maxRows) return;
      const values = (row.values as unknown[]).slice(1, 1 + lim.maxCols);
      lines.push(values.map((v) => csvCell(cellToString(v))).join(","));
    });
    const csv = lines.join("\n").trim();
    if (csv) parts.push({ name: ws.name, csv });
  }
  return parts;
}

function csvCell(text: string): string {
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
