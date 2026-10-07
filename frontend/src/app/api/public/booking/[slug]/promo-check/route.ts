import { NextRequest } from "next/server";
import { z } from "zod";
import { ApiError, successResponse } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { normalizePhoneDigits } from "@/lib/member-portal/otp";
import { previewPromoCode } from "@/lib/promo/promo-server";
import { resolvePublicVenue } from "@/lib/ticketing/booking-server";
import { assertPublicRateLimit } from "@/lib/ticketing/rate-limit";

// EPIC-032 B1 — endpoint PUBLIK validasi kode promo utk wizard booking.
// INDIKATIF (read-only tanpa klaim): kebenaran final tetap hold di dalam
// transaksi create. Subtotal dari klien hanya utk preview besar potongan.
// Rate limit ketat (anti brute-force kode; pesan kode-tak-dikenal =
// nonaktif, anti-enumerasi).

const checkSchema = z.object({
  code: z.string().trim().min(3).max(40),
  subtotal: z.number().min(0).max(1_000_000_000),
  phone: z.string().trim().max(25).optional(),
});

export const POST = apiHandler(
  async (request: NextRequest, { params }: { params: Promise<{ slug: string }> }) => {
    assertPublicRateLimit(
      request.headers,
      "promo-check",
      { limit: 15, windowMs: 60_000 },
      "Terlalu banyak percobaan — coba lagi sebentar"
    );
    const { slug } = await params;
    // Tanpa detail issue: endpoint publik tidak membocorkan skema
    const parsed = checkSchema.safeParse(await request.json());
    if (!parsed.success) throw ApiError.badRequest("Validation failed");

    const venue = await resolvePublicVenue(slug);
    if (!venue) throw ApiError.notFound("Not found");
    const preview = await previewPromoCode({
      scope: { companyId: venue.companyId, branchId: venue.branchId },
      code: parsed.data.code,
      channel: "ticketing_online",
      subtotal: parsed.data.subtotal,
      phone: parsed.data.phone ? normalizePhoneDigits(parsed.data.phone) : null,
    });
    return successResponse(preview);
  },
  "public.booking.promo-check.POST"
);
