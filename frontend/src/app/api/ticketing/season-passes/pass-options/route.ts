import { successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { listPassOptions } from "@/lib/ticketing/season-pass-server";
import { ticketingContext } from "@/lib/ticketing/server";

export const GET = apiHandler(async () => {
  const ctx = await ticketingContext(IAM.ticketingOperator);
  return successResponse(await listPassOptions(ctx));
}, "ticketing.season-passes.options.GET");
