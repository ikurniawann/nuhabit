import { NextRequest } from "next/server";
import { ApiError, successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { todayInJakarta } from "@/lib/ticketing/booking";
import { addDaysIso, dateRangeError } from "@/lib/ticketing/calendar";
import { loadTicketingReport } from "@/lib/ticketing/reports-server";
import { ticketingContext } from "@/lib/ticketing/server";

const MAX_RANGE_DAYS = 92;

/** Laporan Ticketing; default 7 hari terakhir s/d hari ini (WIB). */
export const GET = apiHandler(async (request: NextRequest) => {
  const ctx = await ticketingContext(IAM.ticketingReports);
  const sp = request.nextUrl.searchParams;
  const to = sp.get("to") ?? todayInJakarta();
  const from = sp.get("from") ?? addDaysIso(to, -6);
  const rangeError = dateRangeError(from, to, MAX_RANGE_DAYS);
  if (rangeError) throw ApiError.badRequest(rangeError);
  return successResponse(await loadTicketingReport(ctx, from, to));
}, "ticketing.reports.GET");
