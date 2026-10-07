import { NextRequest } from "next/server";
import { successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { assertStaffRateLimit } from "@/lib/ticketing/rate-limit";
import { ticketingContext } from "@/lib/ticketing/server";
import { settleSchema, settleVisit } from "@/lib/ticketing/visit-settlement-server";

export const POST = apiHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await ticketingContext(IAM.ticketingOperator);
    assertStaffRateLimit(
      `ticketing-settle:${ctx.user.id}`,
      20,
      "Terlalu banyak settlement — coba lagi sebentar"
    );
    const { id } = await params;
    const body = await validateBody(request, settleSchema);
    return successResponse(await settleVisit(ctx, id, body), "Settlement berhasil");
  },
  "ticketing.visits.settle.POST"
);
