import { NextRequest } from "next/server";
import { successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { deleteProductDateRange } from "@/lib/ticketing/product-calendar-server";
import { ticketingContext } from "@/lib/ticketing/server";

export const DELETE = apiHandler(
  async (
    _request: NextRequest,
    { params }: { params: Promise<{ id: string; dateId: string }> }
  ) => {
    const ctx = await ticketingContext();
    const { id, dateId } = await params;
    await deleteProductDateRange(ctx, id, dateId);
    return successResponse({ id: dateId }, "Rentang tanggal dihapus");
  },
  "ticketing.products.dates.DELETE"
);
