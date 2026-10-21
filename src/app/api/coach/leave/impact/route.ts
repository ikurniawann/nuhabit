import { NextRequest, NextResponse } from "next/server";
import { ApiError } from "@/lib/api/auth";
import { MAX_IMPACT_RANGE_DAYS, summarizeImpact } from "@/lib/studio/coach-leave";
import { listCoachSessionsInRange } from "@/lib/studio/coach-leave-server";
import { requireCoach } from "@/lib/studio/coach-portal";
import { addDays, isValidDate } from "@/lib/studio/schedule";
import { studioRoute } from "@/lib/studio/server";

/** Sesi kelas & Personal Training coach yang terdampak bila cuti di rentang start..end. */
export async function GET(request: NextRequest) {
  return studioRoute("coach leave impact", async () => {
    const { coach } = await requireCoach();
    const start = request.nextUrl.searchParams.get("start") ?? "";
    const end = request.nextUrl.searchParams.get("end") ?? "";
    if (!isValidDate(start) || !isValidDate(end) || end < start) {
      throw ApiError.badRequest("Rentang tanggal tidak valid");
    }
    if (end > addDays(start, MAX_IMPACT_RANGE_DAYS - 1)) {
      throw ApiError.badRequest(`Rentang cuti maksimal ${MAX_IMPACT_RANGE_DAYS} hari`);
    }
    const sessions = await listCoachSessionsInRange(coach.id, start, end);
    return NextResponse.json({ success: true, data: { sessions, summary: summarizeImpact(sessions) } });
  });
}
