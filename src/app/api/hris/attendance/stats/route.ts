import { NextRequest, NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { loadAttendanceStats, resolveStatsPeriod } from "@/lib/hris/attendance-repo";
import { requireWorkforceActor } from "@/lib/hris/workforce-route";

/**
 * GET /api/hris/attendance/stats?month=7&year=2026 — statistik absensi bulan
 * berjalan utk halaman rekap HRD. Non-HR dibatasi datanya sendiri.
 */
export const GET = apiHandler(async (req: NextRequest) => {
  const actor = await requireWorkforceActor();
  const { month, year } = resolveStatsPeriod(req.nextUrl.searchParams);
  return NextResponse.json({ data: await loadAttendanceStats(actor, month, year) });
}, "hris/attendance/stats GET");
