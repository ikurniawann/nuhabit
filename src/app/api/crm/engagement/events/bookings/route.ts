import { z } from "zod";
import { getPool } from "@/lib/db";
import { engagementRoute, fail, ok } from "@/lib/crm/engagement/admin-route";
import { changeBooking } from "@/lib/crm/engagement/server";

/** GET ?event_id= — daftar peserta: terkonfirmasi, waitlist, lalu sisanya. */
export const GET = engagementRoute("Gagal memuat peserta", async (request: Request) => {
  const eventId = new URL(request.url).searchParams.get("event_id") ?? "";
  if (!z.string().uuid().safeParse(eventId).success) return fail("ID event tidak valid");
  const { rows } = await getPool().query(
    `SELECT b.id, b.status, b.waitlist_position, b.late_cancel, b.created_at, b.cancelled_at,
            c.name, c.phone
       FROM crm.event_bookings b JOIN pos.pos_customers c ON c.id = b.customer_id
      WHERE b.event_id = $1
      ORDER BY array_position(ARRAY['confirmed','attended','waitlist','no_show','cancelled'], b.status),
               b.waitlist_position NULLS LAST, b.created_at`,
    [eventId]
  );
  return ok(rows);
});

const changeSchema = z.object({
  booking_id: z.string().uuid(),
  status: z.enum(["attended", "no_show", "cancelled"]),
});

/** POST — tandai hadir/tidak hadir, atau batalkan atas nama member. */
export const POST = engagementRoute("Gagal mengubah booking", async (request: Request) => {
  const payload = changeSchema.parse(await request.json());
  const result = await changeBooking(payload.booking_id, payload.status);
  if (!result.ok) return fail(result.error, 409);
  return ok(result);
});
