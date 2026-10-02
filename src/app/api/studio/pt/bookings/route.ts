import { NextRequest, NextResponse } from "next/server";
import { validateBody } from "@/lib/api/auth";
import { query } from "@/lib/db";
import { createPtBooking } from "@/lib/studio/pt-server";
import { ptBookingSchema } from "@/lib/studio/schemas";
import { requireStudioContext, staffActor, studioRoute } from "@/lib/studio/server";

/** Sesi Personal Training mendatang (dan 7 hari terakhir) beserta member. */
export async function GET() {
  return studioRoute("pt bookings GET", async () => {
    const ctx = await requireStudioContext();
    const rows = await query(
      `SELECT s.id AS session_id, s.session_date::text AS session_date, to_char(s.start_time,'HH24:MI') AS start_time,
              to_char(s.end_time,'HH24:MI') AS end_time, s.status AS session_status, p.name AS program_name,
              c.full_name AS coach_name, b.id AS booking_id, b.status AS booking_status, b.source,
              cu.name AS member_name, cu.phone AS member_phone, mp.pass_code
       FROM studio.class_sessions s
       JOIN studio.programs p ON p.id = s.program_id
       LEFT JOIN studio.coaches c ON c.id = s.coach_id
       LEFT JOIN LATERAL (SELECT * FROM studio.bookings b WHERE b.session_id = s.id ORDER BY b.created_at DESC LIMIT 1) b ON true
       LEFT JOIN pos.pos_customers cu ON cu.id = b.customer_id
       LEFT JOIN studio.member_passes mp ON mp.id = b.pass_id
       WHERE s.branch_id = $1 AND s.origin = 'pt_booking'
         AND s.session_date >= (now() AT TIME ZONE 'Asia/Jakarta')::date - 7
       ORDER BY s.session_date, s.start_time
       LIMIT 300`,
      [ctx.branchId]
    );
    return NextResponse.json({ success: true, data: rows });
  });
}

export async function POST(request: NextRequest) {
  return studioRoute("pt bookings POST", async () => {
    const ctx = await requireStudioContext("create");
    const b = await validateBody(request, ptBookingSchema);
    const res = await createPtBooking(staffActor(ctx), { ...b, source: "front_desk" });
    return NextResponse.json(
      { success: true, data: res, message: `Personal Training terbooking ${b.date} ${b.start_time}–${res.end_time} · sisa ${res.pt_left} sesi di pass ${res.pass_code}` },
      { status: 201 }
    );
  });
}
