import { NextRequest } from "next/server";
import { successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import {
  issuePassSchema,
  issueSeasonPass,
  listSeasonPasses,
} from "@/lib/ticketing/season-pass-server";
import { ticketingContext } from "@/lib/ticketing/server";

export const GET = apiHandler(async (request: NextRequest) => {
  const ctx = await ticketingContext(IAM.ticketingOperator);
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim();
  return successResponse(await listSeasonPasses(ctx, q));
}, "ticketing.season-passes.GET");

export const POST = apiHandler(async (request: NextRequest) => {
  const ctx = await ticketingContext(IAM.ticketingOperator);
  const body = await validateBody(request, issuePassSchema);
  const pass = await issueSeasonPass(ctx, body);
  return successResponse(pass, `Pass ${pass.pass_code} diterbitkan`);
}, "ticketing.season-passes.POST");
