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
              COALESCE(bk.waitlist, 0)::int AS waitlist_count
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
