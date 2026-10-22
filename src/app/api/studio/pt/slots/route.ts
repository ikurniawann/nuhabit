import { NextRequest, NextResponse } from "next/server";
import { ApiError } from "@/lib/api/auth";
import { loadPtSlots } from "@/lib/studio/pt-server";
import { requireStudioContext, studioRoute } from "@/lib/studio/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET ?program_id=&date=&coach_id=&exclude_session_id= → slot kosong per coach. */
export async function GET(request: NextRequest) {
  return studioRoute("pt slots", async () => {
    const ctx = await requireStudioContext();
    const sp = request.nextUrl.searchParams;
    const programId = sp.get("program_id");
    const date = sp.get("date");
    if (!programId || !date) throw ApiError.badRequest("program_id dan date wajib");
    // exclude_session_id: sesi yang sedang di-reschedule tidak dihitung sibuk (T-067-A7).
    const data = await loadPtSlots(ctx.branchId, { programId, date, coachId: sp.get("coach_id"), staff: true, excludeSessionId: UUID.test(sp.get("exclude_session_id") ?? "") ? sp.get("exclude_session_id") : null,
    });
    return NextResponse.json({ success: true, data });
  });
}
