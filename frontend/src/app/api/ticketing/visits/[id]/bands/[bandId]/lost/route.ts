import { NextRequest } from "next/server";
import { successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { assertStaffRateLimit } from "@/lib/ticketing/rate-limit";
import { ticketingContext } from "@/lib/ticketing/server";
import { markVisitBandLost } from "@/lib/ticketing/visits-server";

export const POST = apiHandler(
  async (
    _request: NextRequest,
    { params }: { params: Promise<{ id: string; bandId: string }> }
  ) => {
    const ctx = await ticketingContext(IAM.ticketingOperator);
    assertStaffRateLimit(
      `ticketing-band-lost:${ctx.user.id}`,
      20,
      "Terlalu banyak aksi — coba lagi sebentar"
    );
    const { id, bandId } = await params;
    return successResponse(
      await markVisitBandLost(ctx, id, bandId),
      "Gelang ditandai hilang — tagihannya tetap tertagih saat settlement"
    );
  },
  "ticketing.visits.band-lost.POST"
);
