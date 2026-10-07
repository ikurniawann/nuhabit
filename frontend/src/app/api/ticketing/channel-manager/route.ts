import { successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { loadChannelBoard } from "@/lib/ticketing/product-sales-server";
import { ticketingContext } from "@/lib/ticketing/server";

export const GET = apiHandler(async () => {
  const ctx = await ticketingContext();
  return successResponse(await loadChannelBoard(ctx));
}, "ticketing.channel-manager.GET");
