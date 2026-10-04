import { NextRequest } from "next/server";
import { successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import {
  bulkProductDatesSchema,
  saveProductDateMarks,
} from "@/lib/ticketing/product-calendar-server";
import { ticketingContext } from "@/lib/ticketing/server";

export const POST = apiHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await ticketingContext();
    const { id } = await params;
    const body = await validateBody(request, bulkProductDatesSchema);
    await saveProductDateMarks(ctx, id, body);
    const counts = { added: body.add.length, removed: body.remove.length };
    return counts.added + counts.removed === 0
      ? successResponse(counts)
      : successResponse(counts, "Kalender tersimpan");
  },
  "ticketing.products.dates.bulk.POST"
);
