import { NextRequest, NextResponse } from "next/server";
import { ApiError } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { todayWib } from "@/lib/hris/attendance-repo";
import { loadDailyRoster } from "@/lib/hris/attendance-roster";
import { DATE_RE, requireWorkforceActor } from "@/lib/hris/workforce-route";

/**
 * GET /api/hris/attendance/daily-roster?date=YYYY-MM-DD — roster kehadiran
 * satu hari utk monitoring HRD. Khusus HR.
 */
export const GET = apiHandler(async (req: NextRequest) => {
  const actor = await requireWorkforceActor();
  if (!actor.isHr) throw ApiError.forbidden("Forbidden");

  const requested = req.nextUrl.searchParams.get("date");
  if (requested && !DATE_RE.test(requested)) {
    throw ApiError.badRequest("Format tanggal tidak valid");
  }
  const today = todayWib();
  return NextResponse.json({ data: await loadDailyRoster(requested || today, today) });
}, "hris/attendance/daily-roster GET");
