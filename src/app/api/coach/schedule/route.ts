import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireCoach } from "@/lib/studio/coach-portal";
import { venueToday } from "@/lib/studio/pass-server";
import { addDays, isValidDate } from "@/lib/studio/schedule";
import { studioRoute } from "@/lib/studio/server";

/** Jadwal mengajar coach (kelas & Personal Training), default 2 hari lalu s/d 13 hari ke depan. */
export async function GET(request: NextRequest) {
  return studioRoute("coach schedule", async () => {
    const { coach } = await requireCoach();
    const today = await venueToday();
    const qf = request.nextUrl.searchParams.get("from") ?? "";
    const from = isValidDate(qf) ? qf : addDays(today, -2);
    const to = addDays(from, 15);
    const rows = await query(
      `SELECT s.id, s.session_date::text AS session_date, to_char(s.start_time,'HH24:MI') AS start_time,
              to_char(s.end_time,'HH24:MI') AS end_time, s.status, s.capacity, p.name AS program_name, p.kind AS program_kind,
              COALESCE(bk.booked, 0)::int AS booked_count, COALESCE(bk.attended, 0)::int AS attended_count,
              COALESCE(bk.waitlist, 0)::int AS waitlist_count,
              (s.session_date + s.start_time) > (now() AT TIME ZONE 'Asia/Jakarta') AS upcoming,
              -- Penanda dari PAR-Q member di sesi ini yang belum ditinjau (T-067-C3).
              (SELECT COUNT(*) FROM studio.member_flags f JOIN studio.bookings b ON b.customer_id = f.customer_id
               WHERE b.session_id = s.id AND b.status IN ('booked','attended') AND f.branch_id = s.branch_id
                 AND f.needs_review AND f.removed_at IS NULL)::int AS flags_to_review,
              -- Booking Personal Training yang masih aktif → bisa dipindah dari Coach Portal (T-067-A7).
              CASE WHEN p.kind = 'pt' AND s.origin = 'pt_booking' THEN
                (SELECT b.id FROM studio.bookings b WHERE b.session_id = s.id AND b.status = 'booked' LIMIT 1) END AS pt_booking_id,
              CASE WHEN p.kind = 'pt' THEN
                (SELECT cu.name FROM studio.bookings b JOIN pos.pos_customers cu ON cu.id = b.customer_id
                 WHERE b.session_id = s.id AND b.status IN ('booked','attended') LIMIT 1) END AS pt_member_name
       FROM studio.class_sessions s
       JOIN studio.programs p ON p.id = s.program_id
       LEFT JOIN LATERAL (
         SELECT COUNT(*) FILTER (WHERE b.status IN ('booked','attended')) AS booked,
                COUNT(*) FILTER (WHERE b.status = 'attended') AS attended,
                COUNT(*) FILTER (WHERE b.status = 'waitlisted') AS waitlist
         FROM studio.bookings b WHERE b.session_id = s.id
       ) bk ON true
       WHERE s.coach_id = $1 AND s.session_date BETWEEN $2::date AND $3::date
       ORDER BY s.session_date, s.start_time`,
      [coach.id, from, to]
    );
    return NextResponse.json({ success: true, data: rows, today });
  });
}
