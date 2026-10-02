import { NextRequest, NextResponse } from "next/server";
import { validateBody } from "@/lib/api/auth";
import { query } from "@/lib/db";
import { createBooking, loadSettings } from "@/lib/studio/booking-server";
import { requireMemberStudio } from "@/lib/studio/member-server";
import { memberBookSchema } from "@/lib/studio/schemas";
import { studioRoute } from "@/lib/studio/server";

/** Booking saya: mendatang + 30 hari terakhir. */
export async function GET() {
  return studioRoute("member bookings GET", async () => {
    const { customerId, actor } = await requireMemberStudio();
    const rows = await query(
      `SELECT b.id, b.status, b.booked_at, b.checked_in_at, b.cancelled_at,
              s.id AS session_id, s.session_date::text AS session_date, to_char(s.start_time,'HH24:MI') AS start_time,
              to_char(s.end_time,'HH24:MI') AS end_time, p.name AS program_name, p.kind AS program_kind,
              COALESCE(c.display_name, c.full_name) AS coach_name, mp.pass_code,
              (s.session_date + s.start_time) > (now() AT TIME ZONE 'Asia/Jakarta') AS upcoming
       FROM studio.bookings b
       JOIN studio.class_sessions s ON s.id = b.session_id
       JOIN studio.programs p ON p.id = s.program_id
       LEFT JOIN studio.coaches c ON c.id = s.coach_id
       LEFT JOIN studio.member_passes mp ON mp.id = b.pass_id
       WHERE b.customer_id = $1 AND b.branch_id = $2
         AND s.session_date >= (now() AT TIME ZONE 'Asia/Jakarta')::date - 30
       ORDER BY s.session_date DESC, s.start_time DESC
       LIMIT 100`,
      [customerId, actor.branchId]
    );
    const settings = await loadSettings(actor.branchId);
    return NextResponse.json({ success: true, data: rows, rules: { cancel_window_hours: settings.cancel_window_hours } });
  });
}

export async function POST(request: NextRequest) {
  return studioRoute("member bookings POST", async () => {
    const { customerId, actor } = await requireMemberStudio();
    const b = await validateBody(request, memberBookSchema);
    const res = await createBooking(actor, { session_id: b.session_id, customer_id: customerId, source: "member_app" });
    const message =
      res.status === "waitlisted"
        ? "Kelas penuh. Kamu masuk waitlist — kami kabari kalau ada tempat."
        : `Sesi kamu sudah terkunci. Sisa ${res.class_left} kelas di pass ${res.pass_code}.`;
    return NextResponse.json({ success: true, data: res, message }, { status: 201 });
  });
}
