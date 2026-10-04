import { NextRequest } from "next/server";
import { successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { ticketingContext } from "@/lib/ticketing/server";
import { updateChannel, updateChannelSchema } from "@/lib/ticketing/venue-config-server";

export const PATCH = apiHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await ticketingContext();
    const { id } = await params;
    const body = await validateBody(request, updateChannelSchema);
    return successResponse(await updateChannel(ctx, id, body), "Kanal diperbarui");
  },
  "ticketing.channels.PATCH"
);
