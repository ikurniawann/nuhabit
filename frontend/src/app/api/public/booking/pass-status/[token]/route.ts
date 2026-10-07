import { NextRequest } from "next/server";
import { ApiError, successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { getPassStatus } from "@/lib/ticketing/public-pass-server";
import { assertPublicRateLimit } from "@/lib/ticketing/rate-limit";

// Endpoint PUBLIK: status Season Pass via access_token (64 hex). Token
// salah/tak dikenal → 404 generik (anti-enumerasi).

const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

export const GET = apiHandler(
  async (request: NextRequest, { params }: { params: Promise<{ token: string }> }) => {
    assertPublicRateLimit(request.headers, "pass-status", { limit: 30, windowMs: 60_000 });
    const { token } = await params;
    const status = TOKEN_PATTERN.test(token) ? await getPassStatus(token) : null;
    if (!status) throw ApiError.notFound("Not found");
    return successResponse(status);
  },
  "public.booking.pass-status.GET"
);
