import { NextRequest } from "next/server";
import { successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import {
  setChannelDistribution,
  toggleDistributionSchema,
} from "@/lib/ticketing/product-sales-server";
import { ticketingContext } from "@/lib/ticketing/server";

export const PATCH = apiHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await ticketingContext();
    const { id } = await params;
    const body = await validateBody(request, toggleDistributionSchema);
    await setChannelDistribution(ctx, id, body);
    return successResponse(
      { id, channel_id: body.channel_id, is_distributed: body.is_distributed },
      body.is_distributed ? "Ticket didistribusikan" : "Distribusi dimatikan"
    );
  },
  "ticketing.products.channels.PATCH"
);
