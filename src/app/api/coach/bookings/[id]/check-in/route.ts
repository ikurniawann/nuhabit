import { NextRequest, NextResponse } from "next/server";
import { ApiError } from "@/lib/api/auth";
import { queryOne } from "@/lib/db";
import { checkInBooking, undoCheckIn } from "@/lib/studio/booking-server";
import { assertOwnSession, requireCoach } from "@/lib/studio/coach-portal";
import { venueToday } from "@/lib/studio/pass-server";
import { studioRoute } from "@/lib/studio/server";

type Params = { params: Promise<{ id: string }> };

async function ownBooking(coachId: string, bookingId: string) {
  const b = await queryOne<{ session_id: string }>(`SELECT session_id FROM studio.bookings WHERE id = $1`, [bookingId]);
  if (!b) throw ApiError.notFound("Booking tidak ditemukan");
  const s = await assertOwnSession(coachId, b.session_id);
  if (s.session_date > (await venueToday())) throw ApiError.conflict("Kehadiran hanya bisa ditandai pada hari sesi");
  return s;
}

/** Coach menandai peserta hadir di sesinya sendiri (hari ini atau sesi lewat yang belum diselesaikan). */
export async function POST(_request: NextRequest, { params }: Params) {
  return studioRoute("coach check-in", async () => {
    const { coach, actor } = await requireCoach();
    const { id } = await params;
    await ownBooking(coach.id, id);
    await checkInBooking(actor, id, true);
    return NextResponse.json({ success: true, message: "Ditandai hadir" });
  });
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  return studioRoute("coach undo check-in", async () => {
    const { coach, actor } = await requireCoach();
    const { id } = await params;
    await ownBooking(coach.id, id);
    await undoCheckIn(actor, id);
    return NextResponse.json({ success: true, message: "Tanda hadir dibatalkan" });
  });
}
