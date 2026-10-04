import { NextRequest } from "next/server";
import { successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { ticketingContext } from "@/lib/ticketing/server";
import {
  getVenueSettings,
  updateSettingsSchema,
  updateVenueSettings,
} from "@/lib/ticketing/venue-config-server";

export const GET = apiHandler(async () => {
  const ctx = await ticketingContext();
  return successResponse(await getVenueSettings(ctx));
}, "ticketing.settings.GET");

export const PUT = apiHandler(async (request: NextRequest) => {
  const ctx = await ticketingContext();
  const body = await validateBody(request, updateSettingsSchema);
  return successResponse(await updateVenueSettings(ctx, body), "Pengaturan tersimpan");
}, "ticketing.settings.PUT");
