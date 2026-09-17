import type ExcelJS from "exceljs";

/**
 * Helper gaya Excel rapi (exceljs) untuk ekspor laporan POS dari Desktop →
 * Drive → Reports (owner 2026-09-05): blok judul, tabel berkepala gelap
 * dengan border, format angka Rupiah/persen, baris total, lebar kolom.
 */

export type CellFmt = "rp" | "num" | "qty" | "pct" | "text" | "datetime";
export interface TableCol { header: string; width?: number; fmt?: CellFmt; align?: "left" | "right" | "center" }
export type CellValue = string | number | null | undefined;

const NUM_FMT: Record<CellFmt, string | undefined> = {
  rp: '"Rp "#,##0',
  num: "#,##0",
  qty: "#,##0.##",
  pct: '0.0"%"',
  text: undefined,
  datetime: undefined,
};
const BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFD1D5DB" } },
  left: { style: "thin", color: { argb: "FFD1D5DB" } },
  bottom: { style: "thin", color: { argb: "FFD1D5DB" } },
  right: { style: "thin", color: { argb: "FFD1D5DB" } },
};

export async function newWorkbook(): Promise<ExcelJS.Workbook> {
  const { Workbook } = await import("exceljs");
  const wb = new Workbook();
  wb.creator = "BCD Coffee — Arkiv OS";
  wb.created = new Date();
  return wb;
}

export async function workbookBuffer(wb: ExcelJS.Workbook): Promise<Buffer> {
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Judul (tebal, besar) + baris keterangan abu-abu. Kembalikan baris berikutnya (setelah 1 baris kosong). */
export function addTitleBlock(ws: ExcelJS.Worksheet, title: string, lines: string[]): number {
  const t = ws.getCell(1, 1);
  t.value = title;
  t.font = { bold: true, size: 14, color: { argb: "FF111827" } };
  ws.getRow(1).height = 22;
  lines.forEach((line, i) => {
    const c = ws.getCell(2 + i, 1);
    c.value = line;
    c.font = { size: 10, color: { argb: "FF6B7280" } };
  });
  return 2 + lines.length + 1;
}

/** Sub judul bagian (tebal) pada baris tertentu; kembalikan baris berikutnya. */
export function addSectionTitle(ws: ExcelJS.Worksheet, row: number, text: string): number {
  const c = ws.getCell(row, 1);
  c.value = text;
  c.font = { bold: true, size: 11, color: { argb: "FF111827" } };
  return row + 1;
}

/** Pasangan label–nilai (ringkasan). Kembalikan baris berikutnya (setelah 1 baris kosong). */
export function addKeyValues(
  ws: ExcelJS.Worksheet,
  startRow: number,
  pairs: Array<[string, CellValue, CellFmt?]>
): number {
  pairs.forEach(([label, value, fmt], i) => {
    const r = startRow + i;
    const l = ws.getCell(r, 1);
    l.value = label;
    l.font = { color: { argb: "FF374151" } };
    l.border = BORDER;
    l.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF9FAFB" } };
    const v = ws.getCell(r, 2);
    v.value = value ?? "";
    v.border = BORDER;
    v.alignment = { horizontal: typeof value === "number" ? "right" : "left" };
    if (fmt && NUM_FMT[fmt]) v.numFmt = NUM_FMT[fmt] as string;
    v.font = { bold: true };
  });
  widen(ws, 1, 30);
  widen(ws, 2, 20);
  return startRow + pairs.length + 1;
}

/**
 * Tabel berkepala: header gelap, border tipis, format angka per kolom,
 * baris total opsional (tebal, latar abu). Kembalikan baris berikutnya
 * (setelah 1 baris kosong).
 */
export function addTable(
  ws: ExcelJS.Worksheet,
  startRow: number,
  cols: TableCol[],
  rows: CellValue[][],
  opts: { totals?: CellValue[]; freezeHeader?: boolean; startCol?: number } = {}
): number {
  const c0 = opts.startCol ?? 1;
  const header = ws.getRow(startRow);
  cols.forEach((col, i) => {
    const cell = header.getCell(c0 + i);
    cell.value = col.header;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } };
    cell.alignment = { horizontal: col.align ?? (col.fmt && col.fmt !== "text" && col.fmt !== "datetime" ? "right" : "left"), vertical: "middle", wrapText: true };
    cell.border = BORDER;
    widen(ws, c0 + i, col.width ?? Math.max(10, Math.min(40, col.header.length + 4)));
  });
  header.height = 20;

  rows.forEach((values, ri) => {
    const row = ws.getRow(startRow + 1 + ri);
    cols.forEach((col, i) => {
      const cell = row.getCell(c0 + i);
      const v = values[i];
      cell.value = v === undefined || v === null ? "" : v;
      cell.border = BORDER;
      const fmt = col.fmt ?? "text";
      if (NUM_FMT[fmt] && typeof v === "number") cell.numFmt = NUM_FMT[fmt] as string;
      cell.alignment = { horizontal: col.align ?? (typeof v === "number" ? "right" : "left"), vertical: "top", wrapText: fmt === "text" && typeof v === "string" && v.length > 40 };
      if (ri % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF9FAFB" } };
    });
  });

  let next = startRow + 1 + rows.length;
  if (opts.totals) {
    const row = ws.getRow(next);
    cols.forEach((col, i) => {
      const cell = row.getCell(c0 + i);
      const v = opts.totals?.[i];
      cell.value = v === undefined || v === null ? "" : v;
      cell.font = { bold: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
      cell.border = BORDER;
      const fmt = col.fmt ?? "text";
      if (NUM_FMT[fmt] && typeof v === "number") cell.numFmt = NUM_FMT[fmt] as string;
      cell.alignment = { horizontal: col.align ?? (typeof v === "number" ? "right" : "left") };
    });
    next += 1;
  }
  if (opts.freezeHeader) ws.views = [{ state: "frozen", ySplit: startRow }];
  return next + 1;
}

function widen(ws: ExcelJS.Worksheet, col: number, width: number) {
  const column = ws.getColumn(col);
  column.width = Math.max(column.width ?? 0, width);
}

/** Tanggal/jam WIB ringkas untuk sel teks. */
export function wibDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("id-ID", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta",
  });
}

export function printedLine(now = new Date()): string {
  return `Dicetak: ${now.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" })} WIB`;
}

export const round0 = (v: unknown) => Math.round(Number(v) || 0);
export const round2 = (v: unknown) => Math.round((Number(v) || 0) * 100) / 100;
