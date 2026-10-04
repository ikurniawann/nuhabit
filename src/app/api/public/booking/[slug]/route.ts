import { NextRequest } from "next/server";
import { successResponse, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { appOrigin } from "@/lib/app-origin";
import {
  createBookingSchema,
  createPublicBooking,
} from "@/lib/ticketing/booking-create-server";
import { assertPublicRateLimit } from "@/lib/ticketing/rate-limit";

// Endpoint PUBLIK: buat booking prepaid (harga dihitung ulang server-side,
// lihat booking-create-server). 503 bila Xendit belum siap, 502 bila
// invoice gagal (booking dibatalkan rapi).

export const POST = apiHandler(
  async (request: NextRequest, { params }: { params: Promise<{ slug: string }> }) => {
    assertPublicRateLimit(
      request.headers,
      "booking-create",
      { limit: 5, windowMs: 5 * 60_000 },
      "Terlalu banyak percobaan — coba lagi beberapa menit lagi"
    );
    const { slug } = await params;
    const body = await validateBody(request, createBookingSchema);
    return successResponse(
      await createPublicBooking(slug, body, appOrigin(request)),
      "Booking dibuat — selesaikan pembayaran"
    );
  },
  "public.booking.POST"
);
