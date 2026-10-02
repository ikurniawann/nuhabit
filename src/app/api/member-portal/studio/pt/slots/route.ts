import { NextRequest, NextResponse } from "next/server";
import { ApiError } from "@/lib/api/auth";
import { requireMemberStudio } from "@/lib/studio/member-server";
import { loadPtSlots } from "@/lib/studio/pt-server";
import { studioRoute } from "@/lib/studio/server";

export async function GET(request: NextRequest) {
  return studioRoute("member pt slots", async () => {
    const { actor } = await requireMemberStudio();
    const sp = request.nextUrl.searchParams;
    const programId = sp.get("program_id");
    const date = sp.get("date");
    if (!programId || !date) throw ApiError.badRequest("program_id dan date wajib");
    const data = await loadPtSlots(actor.branchId, { programId, date, coachId: sp.get("coach_id"), staff: false });
    return NextResponse.json({ success: true, data });
  });
}
