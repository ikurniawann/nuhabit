import { NextRequest } from "next/server";
import { successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { assertStaffRateLimit } from "@/lib/ticketing/rate-limit";
import { ticketingContext } from "@/lib/ticketing/server";
import { topUpDeposit, topupSchema } from "@/lib/ticketing/visits-server";

export const POST = apiHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await ticketingContext(IAM.ticketingOperator);
    assertStaffRateLimit(
      `ticketing-topup:${ctx.user.id}`,
      20,
      "Terlalu banyak top-up — coba lagi sebentar"
    );
    const { id } = await params;
    const body = await validateBody(request, topupSchema);
    await topUpDeposit(ctx, id, body);
    return successResponse({ id }, "Top-up tersimpan");
  },
  "ticketing.visits.deposit.POST"
);
