import { NextRequest, NextResponse } from "next/server";
import { ApiError } from "@/lib/api/auth";
import { loadPtSlots } from "@/lib/studio/pt-server";
import { requireStudioContext, studioRoute } from "@/lib/studio/server";

/** GET ?program_id=&date=&coach_id= → slot kosong per coach. */
export async function GET(request: NextRequest) {
  return studioRoute("pt slots", async () => {
    const ctx = await requireStudioContext();
    const sp = request.nextUrl.searchParams;
    const programId = sp.get("program_id");
    const date = sp.get("date");
    if (!programId || !date) throw ApiError.badRequest("program_id dan date wajib");
    const data = await loadPtSlots(ctx.branchId, { programId, date, coachId: sp.get("coach_id"), staff: true });
    return NextResponse.json({ success: true, data });
  });
}
