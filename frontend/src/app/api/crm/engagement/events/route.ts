import { z } from "zod";
import { ApiError, successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { eventSchema, listEvents, saveEvent } from "@/lib/crm/engagement/admin-server";
import { cancelEvent } from "@/lib/crm/engagement/server";
import { parseCrmInput, requireCrmUser } from "@/lib/crm/guards";

/** GET — semua event, terdekat dulu, dengan hitungan peserta. */
export const GET = apiHandler(async () => {
  await requireCrmUser("engagement");
  return successResponse(await listEvents());
}, "crm.engagement.events.GET");

/** POST — buat atau ubah event. Event yang dibatalkan tidak bisa diubah lagi. */
export const POST = apiHandler(async (request: Request) => {
  await requireCrmUser("engagement");
  const event = parseCrmInput(eventSchema, await request.json());
  return successResponse(await saveEvent(event));
}, "crm.engagement.events.POST");

/** DELETE ?id= — batalkan event; setiap member yang terdaftar dikabari. */
export const DELETE = apiHandler(async (request: Request) => {
  await requireCrmUser("engagement");
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!z.string().uuid().safeParse(id).success) throw ApiError.badRequest("ID tidak valid");
  return successResponse({ notified: await cancelEvent(id) });
}, "crm.engagement.events.DELETE");
