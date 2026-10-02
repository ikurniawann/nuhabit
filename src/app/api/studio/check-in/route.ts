import { NextRequest, NextResponse } from "next/server";
import { ApiError, validateBody } from "@/lib/api/auth";
import { query } from "@/lib/db";
import { checkInBooking, createBooking, findCustomerByCode } from "@/lib/studio/booking-server";
import { checkInScanSchema } from "@/lib/studio/schemas";
import { requireStudioContext, staffActor, studioRoute } from "@/lib/studio/server";

/**
 * Scan / ketik kode di front desk: kode pass (NH-XXXXXX) atau nomor HP.
 * Booking hari ini yang paling dekat jamnya di-check-in. Bila belum booking dan
 * `session_id` diberikan (kelas yang sedang dibuka), dibuat walk-in + check-in.
 */
export async function POST(request: NextRequest) {
  return studioRoute("check-in scan", async () => {
    const ctx = await requireStudioContext("update");
    const b = await validateBody(request, checkInScanSchema);
    const member = await findCustomerByCode(b.code);
    if (!member) throw ApiError.notFound("Kode pass / nomor HP tidak dikenal");

    const bookings = await query<{ id: string; session_id: string; status: string; program_name: string; start_time: string }>(
      `SELECT bk.id, bk.session_id, bk.status, p.name AS program_name, to_char(s.start_time,'HH24:MI') AS start_time
       FROM studio.bookings bk
       JOIN studio.class_sessions s ON s.id = bk.session_id JOIN studio.programs p ON p.id = s.program_id
       WHERE bk.customer_id = $1 AND bk.branch_id = $2 AND bk.status IN ('booked','attended')
         AND s.session_date = (now() AT TIME ZONE 'Asia/Jakarta')::date AND s.status = 'scheduled'
         ${b.session_id ? "AND bk.session_id = $3" : ""}
       ORDER BY abs(extract(epoch FROM ((s.session_date + s.start_time) - (now() AT TIME ZONE 'Asia/Jakarta'))))`,
      b.session_id ? [member.id, ctx.branchId, b.session_id] : [member.id, ctx.branchId]
    );
    const actor = staffActor(ctx);
    const target = bookings[0];
    if (target) {
      if (target.status === "attended") {
        return NextResponse.json({ success: true, data: { member, booking_id: target.id, already: true }, message: `${member.name ?? member.phone} sudah check-in ${target.program_name} ${target.start_time}` });
      }
      await checkInBooking(actor, target.id);
      return NextResponse.json({ success: true, data: { member, booking_id: target.id }, message: `✓ ${member.name ?? member.phone} — ${target.program_name} ${target.start_time}` });
    }
    if (!b.session_id) throw ApiError.notFound(`${member.name ?? member.phone} tidak punya booking hari ini — pilih kelas untuk walk-in`);
    const res = await createBooking(actor, { session_id: b.session_id, customer_id: member.id, source: "walk_in", check_in: true });
    if (res.status === "waitlisted") throw ApiError.conflict("Kelas penuh — tidak bisa walk-in");
    return NextResponse.json({ success: true, data: { member, booking_id: res.id, walk_in: true }, message: `✓ Walk-in ${member.name ?? member.phone} · sisa ${res.class_left} kelas` });
  });
}
