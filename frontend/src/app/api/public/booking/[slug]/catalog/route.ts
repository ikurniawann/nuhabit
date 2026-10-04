import { NextRequest } from "next/server";
import { ApiError, successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { todayInJakarta, visitDateWindowError } from "@/lib/ticketing/booking";
import { buildPublicCatalog, resolvePublicVenue } from "@/lib/ticketing/booking-server";
import { assertPublicRateLimit } from "@/lib/ticketing/rate-limit";

// Endpoint PUBLIK (tanpa auth): katalog ticket utk satu tanggal — hanya
// produk Active terdistribusi website ber-harga lengkap. 404 generik utk
// slug tak dikenal (anti-enumerasi).

export const GET = apiHandler(
  async (request: NextRequest, { params }: { params: Promise<{ slug: string }> }) => {
    assertPublicRateLimit(request.headers, "booking-catalog", { limit: 30, windowMs: 60_000 });
    const { slug } = await params;
    const visitDate = request.nextUrl.searchParams.get("date") ?? "";
    const windowError = visitDateWindowError(visitDate, todayInJakarta());
    if (windowError) throw ApiError.badRequest(windowError);

    const venue = await resolvePublicVenue(slug);
    if (!venue) throw ApiError.notFound("Not found");
    return successResponse({
      visit_date: visitDate,
      venue: { name: venue.venueName },
      products: await buildPublicCatalog(venue, visitDate),
    });
  },
  "public.booking.catalog.GET"
);
