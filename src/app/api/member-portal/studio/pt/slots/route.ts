import { NextRequest, NextResponse } from "next/server";
import { ApiError } from "@/lib/api/auth";
import { queryOne } from "@/lib/db";
import { requireMemberStudio } from "@/lib/studio/member-server";
import { loadPtSlots } from "@/lib/studio/pt-server";
import { studioRoute } from "@/lib/studio/server";

export async function GET(request: NextRequest) {
  return studioRoute("member pt slots", async () => {
    const { actor, customerId } = await requireMemberStudio();
    const sp = request.nextUrl.searchParams;
    const programId = sp.get("program_id");
    const date = sp.get("date");
    if (!programId || !date) throw ApiError.badRequest("program_id dan date wajib");
    // Reschedule (T-067-A7): booking_id milik member → sesi itu sendiri tidak dihitung sibuk.
    const bookingId = sp.get("booking_id");
    const own = bookingId && /^[0-9a-f-]{36}$/i.test(bookingId)
      ? await queryOne<{ session_id: string }>(`SELECT session_id FROM studio.bookings WHERE id = $1 AND customer_id = $2`, [bookingId, customerId])
      : null;
    const data = await loadPtSlots(actor.branchId, { programId, date, coachId: sp.get("coach_id"), staff: false, excludeSessionId: own?.session_id ?? null });
    return NextResponse.json({ success: true, data });
  });
}
