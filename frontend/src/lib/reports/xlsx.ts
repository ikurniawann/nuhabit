/** Respons XLSX generik: daftar sheet (array-of-arrays) → file unduhan. */
import { NextResponse } from "next/server";
import { buildXlsxBuffer } from "@/lib/spreadsheet/exceljs-safe";

export type XlsxSheet = { name: string; rows: Array<Array<string | number>> };

export async function xlsxResponse(sheets: XlsxSheet[], filename: string): Promise<NextResponse> {
  const buffer = await buildXlsxBuffer(
    // Nama sheet Excel maksimal 31 karakter.
    sheets.map((sheet) => ({ name: sheet.name.slice(0, 31), rows: sheet.rows })),
  );
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
