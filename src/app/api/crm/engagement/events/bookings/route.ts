import { z } from "zod";
import { ApiError, successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { listEventBookings } from "@/lib/crm/engagement/admin-server";
import { changeBooking } from "@/lib/crm/engagement/server";
import { parseCrmInput, requireCrmUser } from "@/lib/crm/guards";

const changeSchema = z.object({
  booking_id: z.string().uuid(),
  status: z.enum(["attended", "no_show", "cancelled"]),
});

/** GET ?event_id= — daftar peserta: terkonfirmasi, waitlist, lalu sisanya. */
export const GET = apiHandler(async (request: Request) => {
  await requireCrmUser("engagement");
  const eventId = new URL(request.url).searchParams.get("event_id") ?? "";
  if (!z.string().uuid().safeParse(eventId).success) throw ApiError.badRequest("ID event tidak valid");
  return successResponse(await listEventBookings(eventId));
}, "crm.engagement.events.bookings.GET");

/** POST — tandai hadir/tidak hadir, atau batalkan atas nama member. */
export const POST = apiHandler(async (request: Request) => {
  await requireCrmUser("engagement");
  const payload = parseCrmInput(changeSchema, await request.json());
  const result = await changeBooking(payload.booking_id, payload.status);
  if (!result.ok) throw ApiError.conflict(result.error);
  return successResponse(result);
}, "crm.engagement.events.bookings.POST");
