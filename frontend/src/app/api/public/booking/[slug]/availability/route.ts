import { NextRequest } from "next/server";
import { ApiError, successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { resolvePublicVenue } from "@/lib/ticketing/booking-server";
import { dateRangeError } from "@/lib/ticketing/calendar";
import { buildAvailability } from "@/lib/ticketing/capacity-server";
import { assertPublicRateLimit } from "@/lib/ticketing/rate-limit";

// EPIC-031 B3 — endpoint PUBLIK (tanpa auth): peta tanggal tidak-tersedia
// utk kalender wizard. HANYA status penuh/tutup — TANPA angka sisa/kapasitas
// (keputusan owner 25 Jul). Indikatif: kebenaran final tetap guard 409 di
// create booking.

const MAX_RANGE_DAYS = 92;

export const GET = apiHandler(
  async (request: NextRequest, { params }: { params: Promise<{ slug: string }> }) => {
    assertPublicRateLimit(request.headers, "booking-availability", { limit: 30, windowMs: 60_000 });
    const { slug } = await params;
    const from = request.nextUrl.searchParams.get("from") ?? "";
    const to = request.nextUrl.searchParams.get("to") ?? "";
    const rangeError = dateRangeError(from, to, MAX_RANGE_DAYS);
    if (rangeError) throw ApiError.badRequest(rangeError);

    const venue = await resolvePublicVenue(slug);
    if (!venue) throw ApiError.notFound("Not found");
    const dates = await buildAvailability(
      { companyId: venue.companyId, branchId: venue.branchId },
      from,
      to
    );
    return successResponse({ dates });
  },
  "public.booking.availability.GET"
);
