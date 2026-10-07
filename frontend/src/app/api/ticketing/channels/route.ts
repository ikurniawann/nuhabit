import { successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { ticketingContext } from "@/lib/ticketing/server";
import { listChannels } from "@/lib/ticketing/venue-config-server";

export const GET = apiHandler(async () => {
  const ctx = await ticketingContext();
  return successResponse(await listChannels(ctx));
}, "ticketing.channels.GET");
