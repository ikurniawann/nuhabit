import { NextRequest, NextResponse } from "next/server";
import { ApiError } from "@/lib/api/auth";
import { MAX_REPORT_RANGE_DAYS, reportRange } from "@/lib/studio/complaints";
import { complaintReport } from "@/lib/studio/complaints-report-server";
import { venueToday } from "@/lib/studio/pass-server";
import { requireStudioContext, studioRoute } from "@/lib/studio/server";

/** Laporan keluhan (EPIC-067 T-067-B5). ?from=YYYY-MM-DD&to=YYYY-MM-DD (default bulan berjalan). */
export async function GET(request: NextRequest) {
  return studioRoute("complaints report", async () => {
    const ctx = await requireStudioContext(undefined, ["studio.complaints"]);
    const sp = request.nextUrl.searchParams;
    const range = reportRange(sp.get("from"), sp.get("to"), await venueToday());
    if (!range) throw ApiError.badRequest(`Rentang tanggal tidak valid (maksimal ${MAX_REPORT_RANGE_DAYS} hari)`);
    return NextResponse.json({ success: true, data: await complaintReport(ctx.branchId, range.from, range.to) });
  });
}
