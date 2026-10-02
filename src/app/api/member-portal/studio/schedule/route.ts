import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { addDays, isValidDate } from "@/lib/studio/schedule";
import { loadSettings } from "@/lib/studio/booking-server";
import { requireMemberStudio } from "@/lib/studio/member-server";
import { venueToday } from "@/lib/studio/pass-server";
import { studioRoute } from "@/lib/studio/server";
import { applyBookingBenefits } from "@/lib/studio/loyalty";
import { memberBenefits } from "@/lib/studio/loyalty-server";

/** Jadwal kelas yang bisa dibooking member + sisa kursi + status booking saya. */
export async function GET(request: NextRequest) {
  return studioRoute("member schedule", async () => {
    const { customerId, actor } = await requireMemberStudio();
    // Benefit tier (EPIC-066): jendela booking & batas batal mengikuti tier member.
    const settings = applyBookingBenefits(await loadSettings(actor.branchId), await memberBenefits(customerId));
    const today = await venueToday();
    const fromQ = request.nextUrl.searchParams.get("from") ?? "";
    const from = isValidDate(fromQ) && fromQ >= today ? fromQ : today;
    const to = addDays(today, settings.booking_open_days);
    const rows = await query(
      `SELECT s.id, s.session_date::text AS session_date, to_char(s.start_time,'HH24:MI') AS start_time,
              to_char(s.end_time,'HH24:MI') AS end_time, p.name AS program_name, p.description AS program_description,
              p.level_label, c.id AS coach_id, COALESCE(c.display_name, c.full_name) AS coach_name, c.photo_url AS coach_photo,
              s.capacity,
              GREATEST(s.capacity - COALESCE(bk.taken, 0), 0)::int AS spots_left,
              COALESCE(bk.waitlist, 0)::int AS waitlist_count,
              mine.id AS my_booking_id, mine.status AS my_status
       FROM studio.class_sessions s
       JOIN studio.programs p ON p.id = s.program_id AND p.kind = 'class'
       LEFT JOIN studio.coaches c ON c.id = s.coach_id
       LEFT JOIN LATERAL (
         SELECT COUNT(*) FILTER (WHERE b.status IN ('booked','attended')) AS taken,
                COUNT(*) FILTER (WHERE b.status = 'waitlisted') AS waitlist
         FROM studio.bookings b WHERE b.session_id = s.id
       ) bk ON true
       LEFT JOIN LATERAL (
         SELECT b.id, b.status FROM studio.bookings b
         WHERE b.session_id = s.id AND b.customer_id = $4 AND b.status IN ('booked','waitlisted','attended') LIMIT 1
       ) mine ON true
       WHERE s.branch_id = $1 AND s.status = 'scheduled' AND s.session_date BETWEEN $2::date AND $3::date
         AND (s.session_date + s.start_time) > (now() AT TIME ZONE 'Asia/Jakarta')
       ORDER BY s.session_date, s.start_time`,
      [actor.branchId, from, to, customerId]
    );
    return NextResponse.json({ success: true, data: rows, rules: { cancel_window_hours: settings.cancel_window_hours, booking_open_days: settings.booking_open_days } });
  });
}
