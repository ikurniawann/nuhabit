import { NextRequest } from "next/server";
import { ApiError, successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { normalizeBookingCode } from "@/lib/ticketing/booking";
import { lookupBooking } from "@/lib/ticketing/bookings-admin-server";
import { assertStaffRateLimit } from "@/lib/ticketing/rate-limit";
import { ticketingContext } from "@/lib/ticketing/server";

// Fase D4 — loket mencari booking dari kode (scan QR status page / ketik manual).

export const GET = apiHandler(async (request: NextRequest) => {
  const ctx = await ticketingContext(IAM.ticketingOperator);
  assertStaffRateLimit(
    `ticketing-booking-lookup:${ctx.user.id}`,
    60,
    "Terlalu banyak pencarian — tunggu sebentar"
  );
  const code = normalizeBookingCode(request.nextUrl.searchParams.get("code") ?? "");
  if (!code) throw ApiError.badRequest("Kode booking tidak valid (format BK-XXXXXX)");
  return successResponse(await lookupBooking(ctx, code));
}, "ticketing.bookings.lookup.GET");
