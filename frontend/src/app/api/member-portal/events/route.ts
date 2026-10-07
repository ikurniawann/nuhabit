import { z } from "zod";
import { getPool } from "@/lib/db";
import { bookEvent, changeBooking } from "@/lib/crm/engagement/server";
import { BOOKING_DENIAL_LABEL } from "@/lib/crm/engagement/rules";
import { memberError, memberJson, withMemberSession } from "@/lib/member-portal/route";

/** GET — event terbit yang belum selesai, dengan booking milik member ini. */
export const GET = withMemberSession("Gagal memuat event", async (customerId) => {
  const { rows } = await getPool().query(
    `SELECT e.id, e.title, e.description, e.host_name, e.location, e.starts_at, e.ends_at,
            e.capacity, e.price_idr::float AS price_idr, e.booking_closes_hours, e.cancel_deadline_hours,
            (SELECT count(*)::int FROM crm.event_bookings b
              WHERE b.event_id = e.id AND b.status IN ('confirmed', 'attended')) AS confirmed_count,
            mine.id AS booking_id, mine.status AS booking_status, mine.waitlist_position
       FROM crm.events e
       LEFT JOIN LATERAL (
         SELECT b.id, b.status, b.waitlist_position FROM crm.event_bookings b
          WHERE b.event_id = e.id AND b.customer_id = $1 AND b.status <> 'cancelled'
          ORDER BY b.created_at DESC LIMIT 1
       ) mine ON true
      WHERE e.status = 'published' AND e.ends_at > now()
      ORDER BY e.starts_at`,
    [customerId]
  );
  return memberJson(rows);
});

const bookSchema = z.object({ event_id: z.string().uuid() });

/** POST — daftar event: terkonfirmasi, masuk waitlist, atau ditolak dengan alasan. */
export const POST = withMemberSession("Gagal mendaftar event", async (customerId, request: Request) => {
  const parsed = bookSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return memberError("Data tidak valid");
  const decision = await bookEvent(customerId, parsed.data.event_id);
  if (decision.kind === "deny") return memberError(BOOKING_DENIAL_LABEL[decision.reason], 409);
  return memberJson(decision);
});

/** DELETE ?booking_id= — batalkan booking milik sendiri; kursinya pindah ke waitlist. */
export const DELETE = withMemberSession("Gagal membatalkan booking", async (customerId, request: Request) => {
  const bookingId = new URL(request.url).searchParams.get("booking_id") ?? "";
  if (!z.string().uuid().safeParse(bookingId).success) return memberError("ID booking tidak valid");
  const result = await changeBooking(bookingId, "cancelled", { customerId });
  if (!result.ok) return memberError(result.error, 409);
  return memberJson(result);
});
