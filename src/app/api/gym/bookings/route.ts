import { z } from "zod";
import { getPool, withTransaction } from "@/lib/db";
import { IAM } from "@/lib/iam/prefixes";
import { BOOKING_STATUSES } from "@/lib/gym/booking";
import { bookSession } from "@/lib/gym/booking-server";
import { ok, optionalUuid, rangeParams, schedulingRoute } from "@/lib/gym/scheduling-route";

/** GET ?from&to&status&q&session_id — booking per jadwal sesi, terbaru di atas. */
export const GET = schedulingRoute(IAM.gymScheduling, "Gagal memuat booking", async (_userId, request: Request) => {
  const url = new URL(request.url);
  const { from, to } = rangeParams(url, 14);
  const status = url.searchParams.get("status");
  const q = url.searchParams.get("q")?.trim() || null;
  const { rows } = await getPool().query(
    `SELECT b.id, b.status, b.waitlist_position, b.source, b.late_cancel, b.promotion_offered_at,
            b.checked_in_at, b.cancelled_at, b.created_at,
            c.id AS customer_id, c.name AS member_name, c.phone AS member_phone,
            s.id AS session_id, s.starts_at, s.credit_cost, t.name AS class_type_name, co.name AS coach_name
       FROM gym.bookings b
       JOIN gym.class_sessions s ON s.id = b.session_id
       JOIN gym.class_types t ON t.id = s.class_type_id
       LEFT JOIN gym.coaches co ON co.id = s.coach_id
       JOIN pos.pos_customers c ON c.id = b.customer_id
      WHERE s.starts_at >= $1 AND s.starts_at < $2
        AND ($3::text IS NULL OR b.status = $3)
        AND ($4::text IS NULL OR c.name ILIKE '%' || $4 || '%' OR c.phone ILIKE '%' || $4 || '%')
        AND ($5::uuid IS NULL OR b.session_id = $5)
      ORDER BY s.starts_at, b.created_at
      LIMIT 500`,
    [
      from,
      to,
      status && (BOOKING_STATUSES as readonly string[]).includes(status) ? status : null,
      q,
      optionalUuid(url, "session_id") ?? null,
    ]
  );
  return ok(rows);
});

const bookSchema = z.object({ session_id: z.string().uuid(), customer_id: z.string().uuid() });

/** POST — staf mendaftarkan member (aturan sama dengan booking dari portal). */
export const POST = schedulingRoute(IAM.gymScheduling, "Gagal membuat booking", async (_userId, request: Request) => {
  const input = bookSchema.parse(await request.json());
  const result = await withTransaction((client) =>
    bookSession(client, { customerId: input.customer_id, sessionId: input.session_id, source: "admin" })
  );
  return ok(result);
});
