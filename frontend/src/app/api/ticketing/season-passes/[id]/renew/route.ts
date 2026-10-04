import { NextRequest } from "next/server";
import { successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { formatDate } from "@/lib/format";
import { IAM } from "@/lib/iam/prefixes";
import { renewSeasonPass } from "@/lib/ticketing/season-pass-server";
import { ticketingContext } from "@/lib/ticketing/server";

export const POST = apiHandler(
  async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await ticketingContext(IAM.ticketingOperator);
    const { id } = await params;
    const renewed = await renewSeasonPass(ctx, id);
    return successResponse(renewed, `Pass diperpanjang s/d ${formatDate(renewed.valid_until)}`);
  },
  "ticketing.season-passes.renew.POST"
);
