import { NextRequest, NextResponse } from "next/server";
import { ApiError } from "@/lib/api/auth";
import { queryOne } from "@/lib/db";
import { requireCoach } from "@/lib/studio/coach-portal";
import { loadPtSlots } from "@/lib/studio/pt-server";
import { studioRoute } from "@/lib/studio/server";

/** GET ?booking_id=&date= → jam kosong coach ini untuk memindah sesi Personal Training miliknya. */
export async function GET(request: NextRequest) {
  return studioRoute("coach pt slots", async () => {
    const { coach } = await requireCoach();
    const sp = request.nextUrl.searchParams;
    const date = sp.get("date");
    const bookingId = sp.get("booking_id");
    if (!date || !bookingId) throw ApiError.badRequest("booking_id dan date wajib");
    const s = await queryOne<{ session_id: string; program_id: string }>(
      `SELECT s.id AS session_id, s.program_id FROM studio.bookings b JOIN studio.class_sessions s ON s.id = b.session_id
       WHERE b.id = $1 AND s.coach_id = $2`,
      [bookingId, coach.id]
    );
    if (!s) throw ApiError.notFound("Sesi tidak ditemukan");
    const data = await loadPtSlots(coach.branch_id, { programId: s.program_id, date, coachId: coach.id, staff: true, excludeSessionId: s.session_id });
    return NextResponse.json({ success: true, data: data[0]?.slots ?? [] });
  });
}
