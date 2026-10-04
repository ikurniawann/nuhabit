import { NextRequest } from "next/server";
import { successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import {
  channelPricesSchema,
  saveChannelPrices,
} from "@/lib/ticketing/product-sales-server";
import { ticketingContext } from "@/lib/ticketing/server";

export const PUT = apiHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await ticketingContext();
    const { id } = await params;
    const body = await validateBody(request, channelPricesSchema);
    await saveChannelPrices(ctx, id, body);
    return successResponse({ id }, "Harga kanal tersimpan");
  },
  "ticketing.products.channel-prices.PUT"
);
