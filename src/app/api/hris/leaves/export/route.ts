import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { leaveExportQuerySchema, leavesToCsv, loadLeavesForExport } from "@/lib/hris/leaves-export";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { parseInput, searchParamsOf } from "@/lib/payroll/request-input";

/** GET /api/hris/leaves/export: CSV pengajuan cuti (HR). */
export const GET = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.hrisWorkforce);
  const query = parseInput(leaveExportQuerySchema, searchParamsOf(request));
  const rows = await loadLeavesForExport(await createServerPgClient(), query);
  if (rows.length === 0) throw ApiError.notFound("No leave data found");

  const filename = `leave_export_${new Date().toISOString().split("T")[0]}.csv`;
  return new NextResponse(leavesToCsv(rows), {
    headers: {
      "Content-Type": "text/csv;charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}, "hris/leaves/export.GET");
