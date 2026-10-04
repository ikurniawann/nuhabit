import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError } from "@/lib/api/auth";

/** Query string laporan → objek tervalidasi; galat zod jadi 400. */
export function parseReportQuery<T extends z.ZodType>(request: Request, schema: T): z.infer<T> {
  const result = schema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!result.success) throw ApiError.badRequest("Invalid query params", result.error.issues);
  return result.data;
}

/** Tanggal kalender (YYYY-MM-DD) → batas awal/akhir hari dalam UTC, seperti filter lama. */
export function dayStartIso(date: string) {
  return `${date}T00:00:00.000Z`;
}

export function dayEndIso(date: string) {
  return `${date}T23:59:59.999Z`;
}

/** CSV dengan setiap sel diberi tanda kutip dan kutip ganda di-escape. */
export function quotedCsv(header: string[], rows: string[][]) {
  return [
    header.map((h) => `"${h}"`).join(","),
    ...rows.map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")),
  ].join("\n");
}

/** Unduhan CSV bernama `<prefix>-YYYY-MM-DD.csv`. */
export function csvResponse(content: string, filenamePrefix: string) {
  return new NextResponse(content, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="${filenamePrefix}-${new Date().toISOString().split("T")[0]}.csv"`,
    },
  });
}
