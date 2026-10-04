import { NextResponse } from "next/server";
import { buildXlsxBuffer } from "@/lib/spreadsheet/exceljs-safe";

export type PosReportSheet = { name: string; rows: Array<Array<string | number>> };

export async function posReportXlsxResponse(
  sheets: PosReportSheet[],
  filename: string
) {
  const buffer = await buildXlsxBuffer(
    // Nama sheet Excel maksimal 31 karakter.
    sheets.map((sheet) => ({ name: sheet.name.slice(0, 31), rows: sheet.rows })),
  );
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
