import { NextRequest } from "next/server";
import { successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { updateBand, updateBandSchema } from "@/lib/ticketing/bands-server";
import { ticketingContext } from "@/lib/ticketing/server";

export const PATCH = apiHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await ticketingContext();
    const { id } = await params;
    const body = await validateBody(request, updateBandSchema);
    return successResponse(await updateBand(ctx, id, body), "Gelang diperbarui");
  },
  "ticketing.bands.PATCH"
);
