import { NextRequest } from "next/server";
import { successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { ticketingContext } from "@/lib/ticketing/server";
import { getVisitDetail } from "@/lib/ticketing/visits-server";

export const GET = apiHandler(
  async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await ticketingContext(IAM.ticketingOperator);
    const { id } = await params;
    return successResponse(await getVisitDetail(ctx, id));
  },
  "ticketing.visits.detail.GET"
);
