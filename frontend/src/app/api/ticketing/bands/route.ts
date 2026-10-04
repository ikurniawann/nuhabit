import { NextRequest } from "next/server";
import { createdResponse, paginatedResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { createBandSchema, listBands, registerBand } from "@/lib/ticketing/bands-server";
import { ticketingContext } from "@/lib/ticketing/server";
import { pageMeta, readPage } from "@/lib/ticketing/sql";

export const GET = apiHandler(async (request: NextRequest) => {
  const ctx = await ticketingContext();
  const sp = request.nextUrl.searchParams;
  const { page, limit } = readPage(sp, 100);
  const { items, total } = await listBands(ctx, {
    q: sp.get("q")?.trim() ?? "",
    status: sp.get("status") ?? "",
    page,
    limit,
  });
  return paginatedResponse(items, pageMeta(page, limit, total));
}, "ticketing.bands.GET");

export const POST = apiHandler(async (request: NextRequest) => {
  const ctx = await ticketingContext();
  const body = await validateBody(request, createBandSchema);
  return createdResponse(await registerBand(ctx, body), "Gelang terdaftar");
}, "ticketing.bands.POST");
