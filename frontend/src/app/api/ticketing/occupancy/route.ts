import { NextRequest } from "next/server";
import { ApiError, successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { dateRangeError } from "@/lib/ticketing/calendar";
import { buildOccupancy } from "@/lib/ticketing/capacity-server";
import { ticketingContext } from "@/lib/ticketing/server";

// EPIC-031 Fase C — okupansi harian utk dashboard ops. Angka booked/
// capacity BOLEH tampil di sini (internal) — beda dari availability publik.

const MAX_RANGE_DAYS = 92;

export const GET = apiHandler(async (request: NextRequest) => {
  const ctx = await ticketingContext(IAM.ticketingOperator);
  const from = request.nextUrl.searchParams.get("from") ?? "";
  const to = request.nextUrl.searchParams.get("to") ?? "";
  const rangeError = dateRangeError(from, to, MAX_RANGE_DAYS);
  if (rangeError) throw ApiError.badRequest(rangeError);
  const days = await buildOccupancy(
    { companyId: ctx.companyId, branchId: ctx.branchId },
    from,
    to
  );
  return successResponse({ days });
}, "ticketing.occupancy.GET");
