import { NextRequest } from "next/server";
import { ApiError, successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { resolvePublicVenue } from "@/lib/ticketing/booking-server";
import { listOnlinePasses } from "@/lib/ticketing/public-pass-server";
import { assertPublicRateLimit } from "@/lib/ticketing/rate-limit";

// Endpoint PUBLIK: katalog Season Pass yang dijual ONLINE. 404 generik utk
// slug tak dikenal (anti-enumerasi).

export const GET = apiHandler(
  async (request: NextRequest, { params }: { params: Promise<{ slug: string }> }) => {
    assertPublicRateLimit(request.headers, "pass-catalog", { limit: 30, windowMs: 60_000 });
    const { slug } = await params;
    const venue = await resolvePublicVenue(slug);
    if (!venue) throw ApiError.notFound("Not found");
    return successResponse({
      venue: { name: venue.venueName },
      passes: await listOnlinePasses(venue),
    });
  },
  "public.booking.passes.GET"
);
