import { NextRequest } from "next/server";
import { paginatedResponse, successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { assertStaffRateLimit } from "@/lib/ticketing/rate-limit";
import { ticketingContext } from "@/lib/ticketing/server";
import { pageMeta, readPage } from "@/lib/ticketing/sql";
import {
  registerVisit,
  registerVisitSchema,
} from "@/lib/ticketing/visit-registration-server";
import { VISIT_STATUSES, listVisits } from "@/lib/ticketing/visits-server";

export const GET = apiHandler(async (request: NextRequest) => {
  const ctx = await ticketingContext(IAM.ticketingOperator);
  const sp = request.nextUrl.searchParams;
  const requested = sp.get("status") ?? "";
  const status = (VISIT_STATUSES as readonly string[]).includes(requested) ? requested : "open";
  const { page, limit } = readPage(sp, 50);
  const { items, total } = await listVisits(ctx, {
    status,
    q: (sp.get("q") ?? "").trim(),
    page,
    limit,
  });
  return paginatedResponse(items, pageMeta(page, limit, total));
}, "ticketing.visits.GET");

export const POST = apiHandler(async (request: NextRequest) => {
  const ctx = await ticketingContext(IAM.ticketingOperator);
  assertStaffRateLimit(
    `ticketing-register:${ctx.user.id}`,
    20,
    "Terlalu banyak registrasi — coba lagi sebentar"
  );
  const body = await validateBody(request, registerVisitSchema);
  const id = await registerVisit(ctx, body);
  return successResponse({ id }, "Kunjungan terdaftar");
}, "ticketing.visits.POST");
