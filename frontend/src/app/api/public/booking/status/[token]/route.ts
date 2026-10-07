import { NextRequest } from "next/server";
import { ApiError, successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { getPublicBookingStatus } from "@/lib/ticketing/booking-server";
import { assertPublicRateLimit } from "@/lib/ticketing/rate-limit";

// Endpoint PUBLIK: status booking via capability token (64 hex acak).
// Token salah/tak dikenal → 404 generik, tanpa membedakan "ada tapi bukan
// milikmu" (anti-enumerasi).

const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

export const GET = apiHandler(
  async (request: NextRequest, { params }: { params: Promise<{ token: string }> }) => {
    assertPublicRateLimit(request.headers, "booking-status", { limit: 30, windowMs: 60_000 });
    const { token } = await params;
    const status = TOKEN_PATTERN.test(token) ? await getPublicBookingStatus(token) : null;
    if (!status) throw ApiError.notFound("Not found");
    return successResponse(status);
  },
  "public.booking.status.GET"
);
