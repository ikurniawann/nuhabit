import { NextRequest, NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { getPool } from "@/lib/db";
import { buildReportSheets, reportFileName } from "@/lib/crm/conversation-insights";
import { getConversationInsightReport } from "@/lib/crm/conversation-insights-server";
import { requireCrmUser } from "@/lib/crm/guards";
import { requireReportPeriod } from "@/lib/crm/reports-server";

/**
 * EPIC-029 — laporan agregat analitik percakapan (JSON atau XLSX).
 *
 * Gate menu laporan CRM. Seperti `reports/cs`, respons sengaja TIDAK memuat
 * isi chat, ringkasan per percakapan, nomor telepon, maupun nama customer —
 * hanya angka agregat, kata kunci, dan topik.
 *
 * `format=xlsx` mengembalikan file (3 sheet: Ringkasan, Kata Kunci, Topik) agar
 * bisa dibuka Excel atau di-import ke Google Sheet.
 */
export const GET = apiHandler(async (request: NextRequest) => {
  await requireCrmUser("reports");
  const { searchParams } = request.nextUrl;
  const period = requireReportPeriod(searchParams);
  const report = await getConversationInsightReport(getPool(), period);

  if (searchParams.get("format") !== "xlsx") {
    return NextResponse.json({ success: true, data: report });
  }

  const { buildXlsxBuffer } = await import("@/lib/spreadsheet/exceljs-safe");
  const buffer = await buildXlsxBuffer(
    buildReportSheets(report).map((sheet) => ({ name: sheet.name, rows: sheet.rows })),
  );
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${reportFileName(report.period)}"`,
      "Cache-Control": "no-store",
    },
  });
}, "crm.reports.conversations.GET");
