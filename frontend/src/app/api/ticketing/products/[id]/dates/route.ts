import { NextRequest } from "next/server";
import { successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import {
  addProductDateRange,
  createProductDateSchema,
} from "@/lib/ticketing/product-calendar-server";
import { ticketingContext } from "@/lib/ticketing/server";

export const POST = apiHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await ticketingContext();
    const { id } = await params;
    const body = await validateBody(request, createProductDateSchema);
    return successResponse(await addProductDateRange(ctx, id, body), "Rentang tanggal ditambahkan");
  },
  "ticketing.products.dates.POST"
);
