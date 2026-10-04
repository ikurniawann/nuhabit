import { z } from "zod";
import { getPool, withTransaction } from "@/lib/db";
import { attachCancelInfo, bookSession } from "@/lib/gym/booking-server";
import type { BookingStatus } from "@/lib/gym/booking";
import { memberSchedulingRoute } from "@/lib/gym/scheduling-route";
import { memberJson } from "@/lib/member-portal/route";

/**
 * GET ?scope=upcoming|past — kelas saya. Mendatang: booking aktif yang belum
 * selesai (dengan pratinjau batal). Lampau: 50 terakhir, semua status.
 */
export const GET = memberSchedulingRoute("Gagal memuat kelas saya", async (customerId, request: Request) => {
  const past = new URL(request.url).searchParams.get("scope") === "past";
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT b.id, b.status, b.waitlist_position, b.late_cancel, b.promotion_offered_at, b.checked_in_at,
            b.cancelled_at, b.created_at,
            s.id AS session_id, s.branch_id, s.starts_at, s.ends_at, s.area, s.credit_cost, s.status AS session_status,
            t.name AS class_type_name, t.color, co.name AS coach_name
       FROM gym.bookings b
       JOIN gym.class_sessions s ON s.id = b.session_id
       JOIN gym.class_types t ON t.id = s.class_type_id
       LEFT JOIN gym.coaches co ON co.id = s.coach_id
      WHERE b.customer_id = $1
        AND ${
          past
            ? `(s.ends_at < now() OR b.status IN ('cancelled', 'completed', 'no_show'))`
            : `s.ends_at >= now() AND b.status IN ('confirmed', 'waitlist', 'checked_in')`
        }
      ORDER BY s.starts_at ${past ? "DESC" : "ASC"}
      LIMIT 50`,
    [customerId]
  );
  return memberJson(await attachCancelInfo(pool, rows, (r) => r.status as BookingStatus));
});

const bookSchema = z.object({ session_id: z.string().uuid() });

/** POST {session_id} — booking kelas: terkonfirmasi, masuk waitlist, atau ditolak dengan alasan. */
export const POST = memberSchedulingRoute("Gagal booking kelas", async (customerId, request: Request) => {
  const { session_id } = bookSchema.parse(await request.json());
  const result = await withTransaction((client) =>
    bookSession(client, { customerId, sessionId: session_id, source: "member" })
  );
  return memberJson(result);
});
