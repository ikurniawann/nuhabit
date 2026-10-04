import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { readPrivateFile } from "@/lib/storage-private";
import {
  buildAttendanceCsv,
  buildAttendancePdf,
  buildAttendanceXlsx,
  buildPeriodLabel,
  toReportRows,
} from "@/lib/hris/attendance-report";
import { compressAttendancePhoto } from "@/lib/hris/attendance-photo-compress";
import { listAttendanceForExport, loadCompanyName } from "@/lib/hris/attendance-repo";

/**
 * GET /api/hris/attendance/export?format=csv|xlsx|pdf — ekspor rekap absensi
 * (khusus HR workforce). Excel & PDF (permintaan owner 2026-08-28) karena HR
 * kesulitan membaca CSV; PDF memuat selfie terkompresi.
 */
export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.hrisWorkforce);
  const searchParams = request.nextUrl.searchParams;
  const startDate = searchParams.get("start_date");
  const endDate = searchParams.get("end_date");
  const employeeId = searchParams.get("employee_id");
  const format = searchParams.get("format") || "csv";

  const records = await listAttendanceForExport({
    employeeId,
    startDate,
    endDate,
    status: searchParams.get("status"),
  });
  if (records.length === 0) throw ApiError.notFound("No attendance data found");

  const stamp = new Date().toISOString().split("T")[0];

  if (format === "xlsx" || format === "pdf") {
    const rows = toReportRows(records);
    const meta = {
      companyName: await loadCompanyName(),
      periodLabel: startDate && endDate ? buildPeriodLabel(startDate, endDate) : "Semua tanggal",
      employeeLabel: employeeId && rows.length > 0 ? rows[0].employeeName : null,
      generatedAt: new Date(),
    };

    if (format === "xlsx") {
      const buffer = await buildAttendanceXlsx(rows, meta);
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="rekap-absensi-${stamp}.xlsx"`,
        },
      });
    }

    const buffer = await buildAttendancePdf(rows, meta, async (path) => {
      const { data: file, mime } = await readPrivateFile(path);
      // thumbnail JPEG: rekap sebulan tetap ringan, selfie webp/EXIF ikut beres
      return file ? compressAttendancePhoto(file, mime ?? "") : null;
    });
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="rekap-absensi-${stamp}.pdf"`,
      },
    });
  }

  return new NextResponse(buildAttendanceCsv(records), {
    headers: {
      "Content-Type": "text/csv;charset=utf-8",
      "Content-Disposition": `attachment; filename="attendance_export_${stamp}.csv"`,
    },
  });
}, "hris/attendance/export GET");
